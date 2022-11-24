import arg from 'arg'
import chalk from 'chalk'
import {
  CatalystClient,
  ContentAPI,
  ContentClient,
  DeploymentBuilder
} from 'dcl-catalyst-client'
import { Authenticator } from '@dcl/crypto'
import { EntityType } from '@dcl/schemas'
// import opn from 'opn'

import { isTypescriptProject } from '../project/isTypescriptProject'
import { getSceneFile } from '../sceneJson'
import { Decentraland } from '../lib/Decentraland'
import { IFile } from '../lib/Project'
import * as spinner from '../utils/spinner'
import { debug } from '../utils/logging'
import { buildTypescript } from '../utils/moduleHelpers'
import { validateScene } from '../sceneJson/utils'
import { ErrorType, fail } from '../utils/errors'

export const help = () => `
  Usage: ${chalk.bold('dcl build [options]')}

    ${chalk.dim('Options:')}

      -h, --help                Displays complete help
      -p, --port        [port]  Select a custom port for the development server
      -t, --target              Specifies the address and port for the target catalyst server. Defaults to peer.decentraland.org
      -t, --target-content      Specifies the address and port for the target content server. Example: 'peer.decentraland.org/content'. Can't be set together with --target
      -b, --no-browser          Do not open a new browser window
      --skip-version-checks     Skip the ECS and CLI version checks, avoid the warning message and launch anyway
      --skip-build              Skip build before deploy
      --skip-validations        Skip permissions verifications on the client side when deploying content

    ${chalk.dim('Example:')}

    - Deploy your scene:

      ${chalk.green('$ dcl deploy')}

    - Deploy your scene to a specific content server:

    ${chalk.green('$ dcl deploy --target my-favorite-catalyst-server.org:2323')}
`

export function failWithSpinner(message: string, error?: any): void {
  spinner.fail(message)
  fail(ErrorType.DEPLOY_ERROR, error)
}

export async function main(): Promise<void> {
  const args = arg({
    '--help': Boolean,
    '-h': '--help',
    '--target': String,
    '-t': '--target',
    '--target-content': String,
    '-tc': '--target-content',
    '--skip-validations': Boolean,
    '--skip-version-checks': Boolean,
    '--skip-build': Boolean,
    '--https': Boolean,
    '--force-upload': Boolean,
    '--yes': Boolean,
    '--wallet': String,
    '--signature': String,
    '--timestamp': Number,
    '--port': Number,
    '--no-browser': Boolean,
    '--dry': Boolean,
  })

  if (args['--target'] && args['--target-content']) {
    throw new Error(
      `You can't set both the 'target' and 'target-content' arguments.`
    )
  }

  if (!args['--signature']) {
    throw new Error(
      'You must pass the signature to upload data automatically'
    )
  }

  if (!args['--wallet']) {
    throw new Error(
      'You must pass the wallet address to upload data automatically'
    )
  }

  const workDir = process.cwd()
  const skipVersionCheck = args['--skip-version-checks']
  const skipBuild = args['--skip-build']
  // @ts-ignore
  const noBrowser = args['--no-browser']
  const port = args['--port']
  const parsedPort = typeof port === 'string' ? parseInt(port, 10) : void 0
  const linkerPort = parsedPort && Number.isInteger(parsedPort) ? parsedPort : void 0

  const dcl = new Decentraland({
    isHttps: !!args['--https'],
    workingDir: workDir,
    forceDeploy: args['--force-upload'],
    yes: args['--yes'],
    // validations are skipped for custom content servers
    skipValidations:
      !!args['--skip-validations'] ||
      !!args['--target'] ||
      !!args['--target-content'],
    linkerPort
  })

  const project = dcl.workspace.getSingleProject()
  if (!project) {
    return failWithSpinner(
      'Cannot deploy a workspace, please go to the project directory and run `dcl deploy` again there.'
    )
  }

  if (!skipVersionCheck) {
    await project.checkCLIandECSCompatibility()
  }

  if (!(await isTypescriptProject(workDir))) {
    failWithSpinner(
      `Please make sure that your project has a 'tsconfig.json' file.`
    )
  }

  if (!skipBuild) {
    try {
      await buildTypescript({
        workingDir: workDir,
        watch: false,
        production: true,
        silence: true
      })
    } catch (error) {
      const message = 'Build /scene in production mode failed'
      failWithSpinner(message, error)
    }
  }

  // Obtain list of files to deploy
  const originalFilesToIgnore =
    (await project.getDCLIgnore()) ?? (await project.writeDclIgnore())
  const filesToIgnorePlusEntityJson =
    originalFilesToIgnore.concat('\n entity.json')

  const files: IFile[] = await project.getFiles({
    ignoreFiles: filesToIgnorePlusEntityJson
  })
  const contentFiles = new Map(files.map((file) => [file.path, file.content]))

  // Create scene.json
  const sceneJson = await getSceneFile(workDir)

  // @ts-ignore
  const { entityId, files: entityFiles } = await DeploymentBuilder.buildEntity({
    type: EntityType.SCENE,
    pointers: findPointers(sceneJson),
    files: contentFiles,
    metadata: sceneJson,
    timestamp: args['--timestamp'] ?? Date.now()
  })

  //  Validate scene.json
  validateScene(sceneJson, false)

  const authChain = Authenticator.createSimpleAuthChain(
    entityId,
    args['--wallet'].replace(/^(?=\n)$|^\s*|\s*$|\n\n+/gm, ''),
    args['--signature'].replace(/^(?=\n)$|^\s*|\s*$|\n\n+/gm, '')
  )

  // Uploading data
  let catalyst: ContentAPI
  let customCatalyst = false

  if (args['--target']) {
    let target = args['--target']
    if (target.endsWith('/')) {
      target = target.slice(0, -1)
    }
    catalyst = new CatalystClient({ catalystUrl: target })
    customCatalyst = true
  } else if (args['--target-content']) {
    const targetContent = args['--target-content']
    catalyst = new ContentClient({ contentUrl: targetContent })
    customCatalyst = true
  } else {
    catalyst = await CatalystClient.connectedToCatalystIn({
      network: 'mainnet'
    })
  }

  // @ts-ignore
  const deployData = { entityId, files: entityFiles, authChain }
  const position = sceneJson.scene.base
  const network = 'mainnet'
  const sceneUrl = customCatalyst
    ? `https://play.decentraland.org/?NETWORK=${network}&CATALYST=${catalyst.getContentUrl().replace('/content', '').replace('https://', '')}&position=${position}`
    : `https://play.decentraland.org/?NETWORK=${network}&position=${position}`

  console.log(sceneUrl)

  if (!args['--dry']) {
    try {
      // @ts-ignore
      const response = (await catalyst.deploy(deployData, {
        timeout: '10m'
      })) as { message?: string }
      project.setDeployInfo({ status: 'success' })
    } catch (error: any) {
      debug('\n' + error.stack)
      failWithSpinner('Could not upload content', error)
    }
  }

  return
}

function findPointers(sceneJson: any): string[] {
  return sceneJson.scene.parcels
}
