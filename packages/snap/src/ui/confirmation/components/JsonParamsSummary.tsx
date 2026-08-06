import { ComponentOrElement } from '@metamask/snaps-sdk';
import { Box, Copyable, Text as SnapText } from '@metamask/snaps-sdk/jsx';
import { Json } from '@metamask/utils';

import { i18n } from '../../../utils';

/**
 * Renders decoded Soroban args as labeled rows (`Arg 1`, `Arg 2`, …).
 * All values are {@link Copyable}, including address / contract strkeys.
 *
 * @param params - Field value from {@link ReadableOperationField}.
 * @param params.value - JSON field value (typically `string[]`).
 * @param params.locale - Translation function.
 * @returns JSX for the confirmation row value.
 */
export const JsonParamsSummary = ({
  value,
  locale,
}: {
  value: Json;
  locale: string;
}): ComponentOrElement => {
  const translate = i18n(locale);
  if (Array.isArray(value)) {
    return (
      <Box direction="vertical" alignment="end">
        {value.map((item, index) => {
          const display =
            typeof item === 'string' ? item : JSON.stringify(item);
          return (
            <Box key={`arg-${index}`} direction="vertical" alignment="end">
              <SnapText fontWeight="medium" color="alternative">
                {translate('confirmation.invocation.argument', {
                  index: (index + 1).toString(),
                })}
              </SnapText>
              <Copyable value={display} />
            </Box>
          );
        })}
      </Box>
    );
  }
  if (typeof value === 'object') {
    return <Copyable value={JSON.stringify(value, null, 2)} />;
  }
  return <Copyable value={String(value)} />;
};
