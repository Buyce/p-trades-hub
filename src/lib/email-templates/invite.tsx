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

interface InviteEmailProps {
  siteName: string
  siteUrl: string
  confirmationUrl: string
}

export const InviteEmail = ({
  siteName,
  siteUrl,
  confirmationUrl,
}: InviteEmailProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>You've been invited to join {siteName}</Preview>
    <Body style={main}>
      <Container style={container}>
        <Heading style={h1}>You've been invited</Heading>
        <Text style={text}>
          You've been invited to join{' '}
          <Link href={siteUrl} style={link}>
            <strong>{siteName}</strong>
          </Link>
          . Use the button below to accept the invitation and create your
          password.
        </Text>
        <Button style={button} href={confirmationUrl}>
          Accept Invitation
        </Button>
        <Text style={fallbackText}>
          If the button does not open, copy and paste this invite link into
          your browser:
        </Text>
        <Text style={urlBlock}>
          <Link href={confirmationUrl} style={rawUrlLink}>
            {confirmationUrl}
          </Link>
        </Text>
        <Text style={footer}>
          If you weren't expecting this invitation, you can safely ignore this
          email.
        </Text>
      </Container>
    </Body>
  </Html>
)

export default InviteEmail
