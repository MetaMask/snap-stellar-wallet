import type { ComponentOrElement } from '@metamask/snaps-sdk';
import {
  Box,
  Copyable,
  Heading,
  Section,
  Text as SnapText,
  Divider,
} from '@metamask/snaps-sdk/jsx';

import { InvocationSummary } from './InvocationSummary';
import type { ReadableAuthorizationJson } from '../../../services/transaction/OperationMapper';
import { i18n } from '../../../utils';
import { getParam } from '../utils';

export type AuthorizationsProps = {
  locale: string;
  authorizations: ReadableAuthorizationJson[];
};

export const Authorizations = ({
  authorizations,
  locale,
}: AuthorizationsProps): ComponentOrElement => {
  const translate = i18n(locale);

  return (
    <Section>
      <Heading>{translate('confirmation.authorization.heading')}</Heading>
      {authorizations.map((authJson, index) => {
        const authorizedAddress = getParam<string>(
          authJson.params,
          'authorizedAddress',
        );
        return (
          <Box
            key={`auth-${index}`}
            alignment="space-between"
            direction="vertical"
          >
            {authorizedAddress === null ? null : (
              <Box direction="vertical">
                <SnapText fontWeight="medium" color="alternative">
                  {translate('confirmation.authorization.authorizedAddress')}
                </SnapText>
                <Copyable value={authorizedAddress} />
              </Box>
            )}
            <InvocationSummary
              locale={locale}
              contractAddress={getParam(authJson.params, 'contractId')}
              functionName={getParam(authJson.params, 'functionName')}
              args={getParam(authJson.params, 'arguments')}
            />
            <Box>{null}</Box>
            <Divider />
            <Box>{null}</Box>
          </Box>
        );
      })}
    </Section>
  );
};
