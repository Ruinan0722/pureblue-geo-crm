interface FeishuRequestAccessOptions {
  appID: string
  scopeList?: string[]
  state?: string
  success?: (res: { code: string }) => void
  fail?: (error: { errno?: number; errString?: string }) => void
}

interface FeishuRequestAuthCodeOptions {
  appId: string
  success?: (res: { code: string }) => void
  fail?: (error: { errno?: number; errString?: string }) => void
}

interface Window {
  h5sdk?: {
    ready: (callback: () => void) => void
    error: (callback: (err: unknown) => void) => void
  }
  tt?: {
    requestAccess?: (options: FeishuRequestAccessOptions) => void
    requestAuthCode?: (options: FeishuRequestAuthCodeOptions) => void
  }
}
