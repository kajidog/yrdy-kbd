import type { CodegenConfig } from '@graphql-codegen/cli'

// Generates src/gql from the shared schema. Operations written with the
// generated `graphql()` function are typed automatically; run
// `npm run codegen` after changing the schema or any operation.
const config: CodegenConfig = {
  schema: '../../packages/schema/schema.graphql',
  documents: ['src/**/*.{ts,tsx}', '!src/gql/**'],
  generates: {
    './src/gql/': {
      preset: 'client',
      presetConfig: {
        fragmentMasking: false,
      },
      config: {
        documentMode: 'string',
        useTypeImports: true,
        enumsAsTypes: true,
        scalars: {
          Time: 'string',
          StringMap: 'Record<string, string>',
        },
      },
    },
  },
}

export default config
