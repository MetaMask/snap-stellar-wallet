import type { ComponentOrElement } from '@metamask/snaps-sdk';
import { Box, Copyable, Text as SnapText } from '@metamask/snaps-sdk/jsx';
import type { Json } from '@metamask/utils';

import { JsonParamsSummary } from './JsonParamsSummary';
import { i18n } from '../../../utils';

export type InvocationSummaryProps = {
  locale: string;
  contractAddress: string | null;
  functionName: string | null;
  args: Json;
};

/**
 * Shared Soroban call layout for sign-transaction and sign-auth-entry:
 *
 * - Contract Address (copyable), when present
 * - Function
 * - Argument 1…N (copyable)
 *
 * @param props - Contract / function / args and i18n helper.
 * @param props.locale - The locale to use for the translation.
 * @param props.contractAddress - Contract `C…` strkey, or `null` for deploy.
 * @param props.functionName - Contract function name, if any.
 * @param props.args - Decoded argument display strings.
 * @returns Vertical confirmation rows for one contract invocation.
 */
export const InvocationSummary = ({
  locale,
  contractAddress,
  functionName,
  args,
}: InvocationSummaryProps): ComponentOrElement => {
  const translate = i18n(locale);
  return (
    <Box direction="vertical">
      {contractAddress ? (
        <Box direction="vertical">
          <SnapText fontWeight="medium" color="alternative">
            {translate('confirmation.invocation.contractAddress')}
          </SnapText>
          <Copyable value={contractAddress} />
        </Box>
      ) : null}

      {functionName === null ? null : (
        <Box direction="vertical">
          <SnapText fontWeight="medium" color="alternative">
            {translate('confirmation.invocation.functionName')}
          </SnapText>
          <SnapText>{functionName}</SnapText>
        </Box>
      )}
      {args === null ? null : (
        <JsonParamsSummary value={args} locale={locale} />
      )}
    </Box>
  );
};
