import type { ComponentOrElement } from '@metamask/snaps-sdk';
import {
  Address,
  Banner,
  Box,
  Button,
  Container,
  Divider,
  Footer,
  Heading,
  Icon,
  Section,
  Text as SnapText,
  Tooltip,
} from '@metamask/snaps-sdk/jsx';

import { ConfirmSignAuthEntryFormNames } from './events';
import type { KnownCaip2ChainId } from '../../../../api';
import type {
  ReadableAuthEntry,
  ReadableInvocation,
} from '../../../../handlers/keyring/signAuthEntry';
import type { StellarKeyringAccount } from '../../../../services/account';
import type { Locale } from '../../../../utils';
import { i18n } from '../../../../utils';
import type { ConfirmationBaseProps } from '../../api';
import { NetworkRow } from '../../components/Network';
import { getAccountName } from '../../utils';

export type ConfirmSignAuthEntryProps = Pick<
  ConfirmationBaseProps,
  'scope' | 'locale' | 'networkImage' | 'origin'
> & {
  readableAuthEntry: ReadableAuthEntry;
  account: StellarKeyringAccount;
};

// Vertical, full-width summary of one Soroban authorized invocation. Used both
// for the root call the user is authorizing and recursively (one level deep)
// for any nested calls. Layout follows Freighter: function name as a heading
// at the top, then Contract ID, Function Name, Parameters stacked vertically
// so long values (G/C addresses, i128 amounts) never get squeezed into a
// right-aligned column and wrap badly.
//
// `showNestedCount` controls whether to render a "Nested authorizations: N"
// row inside this card. Disabled for the root and direct sub-invocations
// (whose children we expand into their own card right below) and enabled
// only for deeper nesting where we don't recurse — there the count is the
// only signal the user gets that more calls exist beneath.
const InvocationSummary = ({
  invocation,
  scope,
  translate,
  showHeading,
  showNestedCount,
}: {
  invocation: ReadableInvocation;
  scope: KnownCaip2ChainId;
  translate: ReturnType<typeof i18n>;
  showHeading: boolean;
  showNestedCount: boolean;
}): ComponentOrElement => {
  const { contractAddress, functionName, args, subInvocations } = invocation;

  return (
    <Box direction="vertical">
      {showHeading && functionName !== null ? (
        <Heading size="md">{functionName}</Heading>
      ) : null}

      {contractAddress === null ? (
        <Box direction="vertical">
          <SnapText fontWeight="medium" color="alternative">
            {translate('confirmation.signAuthEntry.contract')}
          </SnapText>
          <SnapText>
            {translate('confirmation.signAuthEntry.createContract')}
          </SnapText>
        </Box>
      ) : (
        <Box direction="vertical">
          <SnapText fontWeight="medium" color="alternative">
            {translate('confirmation.signAuthEntry.contract')}
          </SnapText>
          <Address address={`${scope}:${contractAddress}`} truncate />
        </Box>
      )}

      {functionName === null ? null : (
        <Box direction="vertical">
          <SnapText fontWeight="medium" color="alternative">
            {translate('confirmation.signAuthEntry.function')}
          </SnapText>
          <SnapText>{functionName}</SnapText>
        </Box>
      )}

      {args.length > 0 ? (
        <Box direction="vertical">
          <SnapText fontWeight="medium" color="alternative">
            {translate('confirmation.signAuthEntry.parameters')}
          </SnapText>
          {args.map((arg, index) => (
            <SnapText key={`arg-${index}`}>{arg}</SnapText>
          ))}
        </Box>
      ) : null}

      {showNestedCount && subInvocations.length > 0 ? (
        <Box direction="vertical">
          <SnapText fontWeight="medium" color="alternative">
            {translate('confirmation.signAuthEntry.subInvocations')}
          </SnapText>
          <SnapText>{String(subInvocations.length)}</SnapText>
        </Box>
      ) : null}
    </Box>
  );
};

export const ConfirmSignAuthEntry = ({
  readableAuthEntry,
  account,
  scope,
  locale,
  networkImage,
  origin,
}: ConfirmSignAuthEntryProps): ComponentOrElement => {
  const translate = i18n(locale as Locale);
  const { address } = account;
  const addressCaip10 = getAccountName(scope, address);
  const { subInvocations } = readableAuthEntry;

  return (
    <Container>
      <Box>
        <Box alignment="center" center>
          <Box>{null}</Box>
          <Heading size="lg">
            {translate('confirmation.signAuthEntry.title')}
          </Heading>
          <Box>{null}</Box>
        </Box>

        <Banner severity="warning" title="">
          <SnapText>{translate('confirmation.signAuthEntry.warning')}</SnapText>
        </Banner>

        <Section>
          {origin ? (
            <Box alignment="space-between" direction="horizontal">
              <Box direction="horizontal" alignment="start">
                <SnapText fontWeight="medium" color="alternative">
                  {translate('confirmation.origin')}
                </SnapText>
                <Tooltip content={translate('confirmation.origin.tooltip')}>
                  <Icon name="question" color="muted" />
                </Tooltip>
              </Box>
              <SnapText>{origin}</SnapText>
            </Box>
          ) : null}
          <Box alignment="space-between" direction="horizontal">
            <SnapText fontWeight="medium" color="alternative">
              {translate('confirmation.account')}
            </SnapText>
            <Address address={addressCaip10} truncate displayName avatar />
          </Box>
          {/* Network */}
          <NetworkRow
            networkImage={networkImage}
            scope={scope}
            locale={locale as Locale}
          />
        </Section>

        <Section>
          <InvocationSummary
            invocation={readableAuthEntry}
            scope={scope}
            translate={translate}
            showHeading
            showNestedCount={false}
          />
        </Section>

        {subInvocations.length > 0 ? (
          <Section>
            {subInvocations.map((sub, index) => (
              <Box key={`sub-${index}`} direction="vertical">
                {index > 0 ? <Divider /> : null}
                <InvocationSummary
                  invocation={sub}
                  scope={scope}
                  translate={translate}
                  showHeading
                  showNestedCount
                />
              </Box>
            ))}
          </Section>
        ) : null}
      </Box>
      <Footer>
        <Button name={ConfirmSignAuthEntryFormNames.Cancel}>
          {translate('confirmation.cancelButton')}
        </Button>
        <Button name={ConfirmSignAuthEntryFormNames.Confirm}>
          {translate('confirmation.confirmButton')}
        </Button>
      </Footer>
    </Container>
  );
};
