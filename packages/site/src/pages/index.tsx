import { KeyringRpcMethod, type KeyringAccount } from '@metamask/keyring-api';
import { useState } from 'react';
import { styled } from 'styled-components';

import {
  ConnectButton,
  InstallFlaskButton,
  ReconnectButton,
  Card,
  AddStellarAccountButton,
} from '../components';
import { defaultSnapOrigin } from '../config';
import {
  useMetaMask,
  useInvokeKeyring,
  useInvokeSnap,
  useMetaMaskContext,
  useRequestSnap,
} from '../hooks';
import {
  isLocalSnap,
  shouldDisplayReconnectButton,
  utf8StringToBase64,
} from '../utils';

const Container = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  flex: 1;
  margin-top: 7.6rem;
  margin-bottom: 7.6rem;
  ${({ theme }) => theme.mediaQueries.small} {
    padding-left: 2.4rem;
    padding-right: 2.4rem;
    margin-top: 2rem;
    margin-bottom: 2rem;
    width: auto;
  }
`;

const Heading = styled.h1`
  margin-top: 0;
  margin-bottom: 2.4rem;
  text-align: center;
`;

const Span = styled.span`
  color: ${(props) => props.theme.colors.primary?.default};
`;

const Subtitle = styled.p`
  font-size: ${({ theme }) => theme.fontSizes.large};
  font-weight: 500;
  margin-top: 0;
  margin-bottom: 0;
  ${({ theme }) => theme.mediaQueries.small} {
    font-size: ${({ theme }) => theme.fontSizes.text};
  }
`;

const CardContainer = styled.div`
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  justify-content: space-between;
  max-width: 64.8rem;
  width: 100%;
  height: 100%;
  margin-top: 1.5rem;
`;

const Notice = styled.div`
  background-color: ${({ theme }) => theme.colors.background?.alternative};
  border: 1px solid ${({ theme }) => theme.colors.border?.default};
  color: ${({ theme }) => theme.colors.text?.alternative};
  border-radius: ${({ theme }) => theme.radii.default};
  padding: 2.4rem;
  margin-top: 2.4rem;
  max-width: 60rem;
  width: 100%;

  & > * {
    margin: 0;
  }
  ${({ theme }) => theme.mediaQueries.small} {
    margin-top: 1.2rem;
    padding: 1.6rem;
  }
`;

const ErrorMessage = styled.div`
  background-color: ${({ theme }) => theme.colors.error?.muted};
  border: 1px solid ${({ theme }) => theme.colors.error?.default};
  color: ${({ theme }) => theme.colors.error?.alternative};
  border-radius: ${({ theme }) => theme.radii.default};
  padding: 2.4rem;
  margin-bottom: 2.4rem;
  margin-top: 2.4rem;
  max-width: 60rem;
  width: 100%;
  ${({ theme }) => theme.mediaQueries.small} {
    padding: 1.6rem;
    margin-bottom: 1.2rem;
    margin-top: 1.2rem;
    max-width: 100%;
  }
`;

const MessageField = styled.textarea`
  width: 100%;
  min-height: 8rem;
  margin-top: 1.2rem;
  margin-bottom: 1.2rem;
  padding: 1.2rem;
  border-radius: ${({ theme }) => theme.radii.default};
  border: 1px solid ${({ theme }) => theme.colors.border?.default};
  background-color: ${({ theme }) => theme.colors.background?.default};
  color: ${({ theme }) => theme.colors.text?.default};
  font-family: inherit;
  font-size: ${({ theme }) => theme.fontSizes.text};
  box-sizing: border-box;
  resize: vertical;
`;

const SignatureOutput = styled.pre`
  margin: 1.2rem 0 0;
  padding: 1.2rem;
  max-height: 12rem;
  overflow: auto;
  font-size: ${({ theme }) => theme.fontSizes.small};
  word-break: break-all;
  white-space: pre-wrap;
  border-radius: ${({ theme }) => theme.radii.default};
  border: 1px solid ${({ theme }) => theme.colors.border?.default};
  background-color: ${({ theme }) => theme.colors.background?.alternative};
`;

const SignOpsButton = styled.button`
  display: flex;
  align-self: flex-start;
  align-items: center;
  justify-content: center;
  margin-top: auto;
  ${({ theme }) => theme.mediaQueries.small} {
    width: 100%;
  }
`;

const Index = () => {
  const { error } = useMetaMaskContext();
  const { isFlask, snapsDetected, installedSnap } = useMetaMask();
  const requestSnap = useRequestSnap();
  const invokeSnap = useInvokeSnap();
  const invokeKeyring = useInvokeKeyring();
  const [signMessageText, setSignMessageText] = useState(
    'Hello from the Stellar wallet test dapp',
  );

  const [signTxnText, setSignTxnText] = useState('');
  const [signMessageOutput, setSignMessageOutput] = useState<string | null>(
    null,
  );
  const [signTxnOutput, setSignTxnOutput] = useState<string | null>(null);

  const isMetaMaskReady = isLocalSnap(defaultSnapOrigin)
    ? isFlask
    : snapsDetected;

  const handleAddStellarAccount = async () => {
    await invokeKeyring({
      method: KeyringRpcMethod.CreateAccount,
      params: {
        options: {},
      },
    });
    const accounts = (await invokeKeyring({
      method: KeyringRpcMethod.ListAccounts,
    })) as KeyringAccount[] | null;

    const account = accounts?.[0];
    console.log('account', account);
  };

  const handleSignMessageClick = async () => {
    setSignMessageOutput(null);
    const trimmed = signMessageText.trim();
    if (!trimmed) {
      setSignMessageOutput('Enter a non-empty message to sign.');
      return;
    }

    const accounts = (await invokeKeyring({
      method: KeyringRpcMethod.ListAccounts,
    })) as KeyringAccount[] | null;

    const account = accounts?.[0];
    if (!account) {
      setSignMessageOutput(
        'No keyring accounts found. Add a Stellar account in MetaMask first.',
      );
      return;
    }

    const scope = account.scopes[0];
    if (!scope) {
      setSignMessageOutput('Selected account has no chain scope.');
      return;
    }
    const response = (await invokeSnap({
      method: 'stellar_signMessage',
      params: {
        id: crypto.randomUUID(),
        origin: 'http://localhost:3000',
        scope,
        account: account.id,
        request: {
          method: 'signMessage',
          params: {
            message: utf8StringToBase64(trimmed),
          },
        },
      },
    })) as { pending: false; signature: string } | { pending: true } | null;

    if (!response) {
      return;
    }

    if (response.pending) {
      setSignMessageOutput('Request is pending in MetaMask.');
      return;
    }

    console.log('response', response);

    setSignMessageOutput(response.signature);
  };

  const handleSignTxnClick = async () => {
    setSignTxnOutput(null);
    const trimmed = signTxnText.trim();
    if (!trimmed) {
      setSignTxnOutput('Enter a base64 encoded transaction to sign.');
      return;
    }

    const accounts = (await invokeKeyring({
      method: KeyringRpcMethod.ListAccounts,
    })) as KeyringAccount[] | null;
    const account = accounts?.[accounts.length - 1];
    if (!account) {
      setSignTxnOutput(
        'No keyring accounts found. Add a Stellar account in MetaMask first.',
      );
      return;
    }

    const scope = account.scopes[0];
    if (!scope) {
      setSignTxnOutput('Selected account has no chain scope.');
      return;
    }
    const response = (await invokeSnap({
      method: 'stellar_signTransaction',
      params: {
        id: crypto.randomUUID(),
        origin: 'http://localhost:3000',
        scope,
        account: account.id,
        request: {
          method: 'signTransaction',
          params: {
            transaction: trimmed,
          },
        },
      },
    })) as { pending: false; signature: string } | { pending: true } | null;

    if (!response) {
      return;
    }

    if (response.pending) {
      setSignTxnOutput('Request is pending in MetaMask.');
      return;
    }

    console.log('response', response);

    setSignTxnOutput(response.signature);
  };

  return (
    <Container>
      <Heading>
        Welcome to <Span>template-snap</Span>
      </Heading>
      <Subtitle>
        Get started by editing <code>src/index.tsx</code>
      </Subtitle>
      <CardContainer>
        {error && (
          <ErrorMessage>
            <b>An error happened:</b> {error.message}
          </ErrorMessage>
        )}
        {!isMetaMaskReady && (
          <Card
            content={{
              title: 'Install',
              description:
                'Snaps is pre-release software only available in MetaMask Flask, a canary distribution for developers with access to upcoming features.',
              button: <InstallFlaskButton />,
            }}
            fullWidth
          />
        )}
        {!installedSnap && (
          <Card
            content={{
              title: 'Connect',
              description:
                'Get started by connecting to and installing the example snap.',
              button: (
                <ConnectButton
                  onClick={requestSnap}
                  disabled={!isMetaMaskReady}
                />
              ),
            }}
            disabled={!isMetaMaskReady}
          />
        )}
        {shouldDisplayReconnectButton(installedSnap) && (
          <Card
            content={{
              title: 'Reconnect',
              description:
                'While connected to a local running snap this button will always be displayed in order to update the snap if a change is made.',
              button: (
                <ReconnectButton
                  onClick={requestSnap}
                  disabled={!installedSnap}
                />
              ),
            }}
            disabled={!installedSnap}
          />
        )}
        <Card
          content={{
            title: 'Add new Stellar account',
            description: 'Add a new Stellar account to the wallet.',
            button: (
              <AddStellarAccountButton
                onClick={handleAddStellarAccount}
                disabled={!installedSnap}
              />
            ),
          }}
          disabled={!installedSnap}
          fullWidth={
            isMetaMaskReady &&
            Boolean(installedSnap) &&
            !shouldDisplayReconnectButton(installedSnap)
          }
        />
        <Card
          content={{
            title: 'Sign message (Keyring API)',
            description:
              'Calls keyring_submitRequest with signMessage using the first Stellar keyring account.',
            button: (
              <>
                <MessageField
                  aria-label="Message to sign"
                  value={signMessageText}
                  onChange={({ target }) => setSignMessageText(target.value)}
                  disabled={!installedSnap}
                />
                {signMessageOutput !== null && (
                  <SignatureOutput>{signMessageOutput}</SignatureOutput>
                )}
                <SignOpsButton
                  type="button"
                  onClick={handleSignMessageClick}
                  disabled={!installedSnap}
                >
                  Sign message
                </SignOpsButton>
              </>
            ),
          }}
          disabled={!installedSnap}
          fullWidth
        />

        <Card
          content={{
            title: 'Sign transaction (Keyring API)',
            description:
              'Calls keyring_submitRequest with signTransaction using the first Stellar keyring account.',
            button: (
              <>
                <MessageField
                  aria-label="Transaction to sign"
                  value={signTxnText}
                  onChange={({ target }) => setSignTxnText(target.value)}
                  disabled={!installedSnap}
                />
                {signTxnOutput !== null && (
                  <SignatureOutput>{signTxnOutput}</SignatureOutput>
                )}
                <SignOpsButton
                  type="button"
                  onClick={handleSignTxnClick}
                  disabled={!installedSnap}
                >
                  Sign transaction
                </SignOpsButton>
              </>
            ),
          }}
          disabled={!installedSnap}
          fullWidth
        />

        <Notice>
          <p>
            Please note that the <b>snap.manifest.json</b> and{' '}
            <b>package.json</b> must be located in the server root directory and
            the bundle must be hosted at the location specified by the location
            field.
          </p>
        </Notice>
      </CardContainer>
    </Container>
  );
};

export default Index;
