import * as tb from '@2bad/eslint-config'
import * as plugins from '@2bad/eslint-config/plugins'

export default [tb.setup(import.meta.dirname), tb.configs.strict, ...Object.values(plugins)].flat()
