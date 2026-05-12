/// <reference types="vite/client" />

declare module 'virtual:build-info' {
  import type { BuildInfo } from './build-info'
  export const buildInfo: BuildInfo
}
