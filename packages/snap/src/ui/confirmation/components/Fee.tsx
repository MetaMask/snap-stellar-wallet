import type {
  ComponentOrElement,
  GetPreferencesResult,
} from '@metamask/snaps-sdk';
import { Box, Text as SnapText } from '@metamask/snaps-sdk/jsx';

import { Asset } from './Asset';
import { FetchStatus } from '../api';
import { i18n } from '../../../utils/i18n';
import xlmSvg from '../../images/slip44:148.svg';
import type { FeeData } from '../api';

type FeesProps = {
  fee: FeeData;
  price: string | null;
  preferences: GetPreferencesResult;
  tokenPricesFetchStatus?: FetchStatus;
};

export const FeeRow = ({
  fee,
  preferences,
  price,
  tokenPricesFetchStatus = FetchStatus.Initial,
}: FeesProps): ComponentOrElement => {
  const translate = i18n(preferences.locale);
  const priceLoading = tokenPricesFetchStatus === FetchStatus.Fetching;

  return (
    <Box>
      <Box alignment="space-between" direction="horizontal">
        {/* Left side - show text only for first item (native TRX) */}
        <SnapText fontWeight="medium" color="alternative">
          {translate('confirmation.transactionFee')}
        </SnapText>

        {/* Right side - fee value with asset display including price */}
        <Asset
          amount={fee.amount}
          symbol={fee.symbol}
          iconUrl={xlmSvg}
          price={price}
          preferences={preferences}
          priceLoading={priceLoading}
        />
      </Box>
    </Box>
  );
};
