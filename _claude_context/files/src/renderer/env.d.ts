import type { DsaApi } from '../shared/types'
declare global {
  interface Window {
    dsa: DsaApi
  }
}
