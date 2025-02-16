import path from 'path'
import test from 'ava'

import * as status from '../../src/commands/status'
import { isDebug } from '../../src/utils/env'
import Commando from '../helpers/commando'

test('snapshot - dcl help status', (t) => {
  t.snapshot(status.help())
})

test('E2E - status command', async (t) => {
  await new Promise<void>((resolve) => {
    let allData = ''
    new Commando(
      `node ${path.resolve(
        'dist',
        'index.js'
      )} status --network goerli -35,-130`,
      {
        silent: !isDebug(),
        workingDir: '.',
        env: { NODE_ENV: 'development' }
      },
      (data) => (allData += data)
    ).on('end', async () => {
      t.snapshot(allData)
      resolve()
    })
  })
})
