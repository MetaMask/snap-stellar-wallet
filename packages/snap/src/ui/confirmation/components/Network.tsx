import type { ComponentOrElement } from '@metamask/snaps-sdk';
import { Box, Image, Text as SnapText } from '@metamask/snaps-sdk/jsx';

import type { KnownCaip2ChainId } from '../../../api';
import type { Locale } from '../../../utils';
import { i18n } from '../../../utils';
import { xlmIcon } from '../../images';
import { getNetworkName } from '../utils';

export const NetworkRow = ({
  networkImage,
  scope,
  locale,
}: {
  networkImage?: string | null;
  scope: KnownCaip2ChainId;
  locale: Locale;
}): ComponentOrElement => {
  const translate = i18n(locale);
  return (
    <Box alignment="space-between" direction="horizontal">
      <SnapText fontWeight="medium" color="alternative">
        {translate('confirmation.network')}
      </SnapText>
      <Box direction="horizontal" alignment="end">
        <Image
          borderRadius="medium"
          src={networkImage ?? xlmIcon}
          height={16}
          width={16}
        />
        <SnapText>{getNetworkName(scope)}</SnapText>
      </Box>
    </Box>
  );
};
