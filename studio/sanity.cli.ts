import {defineCliConfig} from 'sanity/cli'

export default defineCliConfig({
  api: {
    projectId: 'f1mbayb1',
    dataset: 'production'
  },
  deployment: {
    appId: 'kc5xpe6gt0rgfc3uxft6cq9b',
    /**
     * Enable auto-updates for studios.
     * Learn more at https://www.sanity.io/docs/studio/latest-version-of-sanity#k47faf43faf56
     */
    autoUpdates: true,
  },
})