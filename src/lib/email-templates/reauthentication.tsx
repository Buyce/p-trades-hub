import * as React from 'react'

import {
  Body,
  Container,
  Head,
  Heading,
  Html,
  Preview,
  Text,
} from '@react-email/components'

interface ReauthenticationEmailProps {
  token: string
}

export const ReauthenticationEmail = ({ token }: ReauthenticationEmailProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>Your verification code</Preview>
    <Body style={main}>
      <Container style={container}>
        <Heading style={h1}>Confirm reauthentication</Heading>
        <Text style={text}>Use the code below to confirm your identity:</Text>
        <Text style={codeStyle}>{token}</Text>
        <Text style={footer}>
          This code will expire shortly. If you didn't request this, you can
          safely ignore this email.
        </Text>
      </Container>
    </Body>
  </Html>
)

export default ReauthenticationEmail

const main = { backgroundColor: '#ffffff', fontFamily: 'IBM Plex Sans', -apple-system, 'Segoe UI', Arial, sans-serif, padding: '24px 0' }
const text = { fontSize: '14px', color: '#4a5563', lineHeight: '1.6', margin: '0 0 22px' }
const codeStyle = { fontFamily: 'IBM Plex Mono', ui-monospace, 'SFMono-Regular', monospace, fontSize: '26px', fontWeight: 600 as const, letterSpacing: '0.18em', color: '#0f1720', backgroundColor: '#f4f6f9', border: '1px solid #e3e8ee', borderRadius: '8px', padding: '14px 18px', display: 'inline-block', margin: '0 0 26px' }
const footer = { fontSize: '12px', color: '#8a94a3', lineHeight: '1.6', borderTop: '1px solid #e3e8ee', paddingTop: '16px', margin: '32px 0 0' }
