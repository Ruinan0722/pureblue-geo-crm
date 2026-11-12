import type { Metadata, Viewport } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import { Toaster } from '@/shared/ui/sonner'
import { AuthProvider } from '@/modules/auth/context/auth-provider'
import { RequestsProvider } from '@/modules/requests/context/requests-provider'
import { AuditProvider } from '@/modules/audit'
import { CrmProvider } from '@/modules/crm/context/crm-provider'
import { AppShell, VersionGuard } from '@/modules/shell'
import { ReleaseNotesDialog } from '@/modules/shell/components/release-notes-dialog'
import './globals.css'

const geistSans = Geist({ variable: '--font-geist-sans', subsets: ['latin'] })
const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
})

export const metadata: Metadata = {
  title: { default: 'Flow', template: '%s · Flow' },
  applicationName: 'Flow',
  description: 'Flow · 清蓝客户经营平台，连接线索、客户、商机、合同与项目交付。',
  icons: {
    icon: [
      { url: '/favicon.ico?v=flow-20261014', sizes: '16x16 32x32 48x48', type: 'image/x-icon' },
      { url: '/brand/flow-favicon.svg?v=20261014', type: 'image/svg+xml' },
      { url: '/brand/flow-favicon-32.png?v=20261014', sizes: '32x32', type: 'image/png' },
    ],
    apple: [{ url: '/brand/flow-apple-touch-icon.png?v=20261014', sizes: '180x180', type: 'image/png' }],
  },
}

export const viewport: Viewport = {
  colorScheme: 'light dark',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: 'white' },
    { media: '(prefers-color-scheme: dark)', color: 'black' },
  ],
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html
      lang="zh-CN"
      className={`${geistSans.variable} ${geistMono.variable} bg-background`}
    >
      <body className="font-sans antialiased">
        <AuthProvider>
          <AuditProvider>
            <RequestsProvider>
              <CrmProvider>
                <AppShell>{children}</AppShell>
                <ReleaseNotesDialog />
              </CrmProvider>
            </RequestsProvider>
          </AuditProvider>
        </AuthProvider>
        <VersionGuard />
        <Toaster richColors position="top-center" />
      </body>
    </html>
  )
}
