import * as React from 'react'
import {
  main,
  container,
  h1,
  text,
  link,
  button,
  footer,
  fallbackText,
  urlBlock,
  rawUrlLink,
} from './styles'

import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Html,
  Link,
  Preview,
  Text,
} from '@react-email/components'

interface SignupEmailProps {
  siteName: string
  siteUrl: string
  recipient: string
  confirmationUrl: string
}

export const SignupEmail = ({
  siteName,
  siteUrl,
  recipient,
  confirmationUrl,
}: SignupEmailProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>Confirm your email for {siteName}</Preview>
    <Body style={main}>
      <Container style={container}>
        <Heading style={h1}>Confirm your email</Heading>
        <Text style={text}>
          Thanks for signing up for{' '}
          <Link href={siteUrl} style={link}>
            <strong>{siteName}</strong>
          </Link>
          .
        </Text>
        <Text style={text}>
          Confirm this email address for your P-Trades account:{' '}
          <Link href={`mailto:${recipient}`} style={link}>
            {recipient}
          </Link>
          . This link opens the secure account confirmation page.
        </Text>
        <Button style={button} href={confirmationUrl}>
          Confirm Email
        </Button>
        <Text style={fallbackText}>
          If the button does not open, copy and paste this confirmation link
          into your browser:
        </Text>
        <Text style={urlBlock}>
          <Link href={confirmationUrl} style={rawUrlLink}>
            {confirmationUrl}
          </Link>
        </Text>
        <Text style={footer}>
          If you didn't create an account, you can safely ignore this email.
        </Text>
      </Container>
    </Body>
  </Html>
)

export default SignupEmail
