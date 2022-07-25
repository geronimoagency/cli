import arg from 'arg'
import chalk from 'chalk'
import {
  DeploymentBuilder
} from 'dcl-catalyst-client'
import { EntityType } from '@dcl/schemas'

import { getSceneFile } from '../sceneJson'
import { Decentraland } from '../lib/Decentraland'
import { IFile } from '../lib/Project'
import * as spinner from '../utils/spinner'
import { validateScene } from '../sceneJson/utils'
import { ErrorType, fail } from '../utils/errors'

export const help = () => `
  Usage: ${chalk.bold('dcl messageToSign [options]')}

    ${chalk.dim('Options:')}

      -h, --help                Displays complete help
      -t, --target              Specifies the address and port for the target catalyst server. Defaults to peer.decentraland.org
      -t, --target-content      Specifies the address and port for the target content server. Example: 'peer.decentraland.org/content'. Can't be set together with --target
      --skip-version-checks     Skip the ECS and CLI version checks, avoid the warning message and launch anyway
      --skip-build              Skip build before deploy

    ${chalk.dim('Example:')}

    - Get message to sign for deploying your scene:

    ${chalk.green('$ dcl messageToSign')}
`

export function failWithSpinner(message: string, error?: any): void {
  spinner.fail(message)
  fail(ErrorType.DEPLOY_ERROR, error)
}

export async function main(): Promise<void> {
  const args = arg({
    '--help': Boolean,
    '-h': '--help',
    '--https': Boolean,
    '--force-upload': Boolean,
    '--yes': Boolean,
    '--timestamp': Number,
  })

  const workDir = process.cwd()

  const dcl = new Decentraland({
    isHttps: !!args['--https'],
    workingDir: workDir,
    forceDeploy: args['--force-upload'],
    yes: args['--yes']
  })

  const project = dcl.workspace.getSingleProject()
  if (!project) {
    return failWithSpinner(
      'Cannot deploy a workspace, please go to the project directory and run `dcl deploy` again there.'
    )
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

  const { entityId } = await DeploymentBuilder.buildEntity({
    type: EntityType.SCENE,
    pointers: findPointers(sceneJson),
    files: contentFiles,
    metadata: sceneJson,
    timestamp: args['--timestamp'] ?? Date.now()
  })

  //  Validate scene.json
  validateScene(sceneJson, false)

  console.log(entityId)

  return
}

function findPointers(sceneJson: any): string[] {
  return sceneJson.scene.parcels
}
