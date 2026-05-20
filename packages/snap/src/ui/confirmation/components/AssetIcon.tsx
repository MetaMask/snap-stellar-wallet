import type { ComponentOrElement } from '@metamask/snaps-sdk';
import { Image } from '@metamask/snaps-sdk/jsx';

import questionMarkSvg from '../../images/question-mark.svg';

type AssetIconProps = {
  iconUrl?: string;
  size: 'sm' | 'md' | 'lg' | 'xl';
};

const sizeMap: Record<'sm' | 'md' | 'lg' | 'xl', number> = {
  sm: 16,
  md: 24,
  lg: 32,
  xl: 48,
};

/**
 * AssetIcon component for displaying assets with optional icon.
 *
 * @param props - The props for the asset component.
 * @returns The rendered asset element.
 */
export const AssetIcon = (props: AssetIconProps): ComponentOrElement => {
  const { iconUrl, size = 'md' } = props;

  const iconSrc = iconUrl ?? questionMarkSvg;

  return (
    <Image
      borderRadius="full"
      src={iconSrc}
      height={sizeMap[size]}
      width={sizeMap[size]}
    />
  );
};
