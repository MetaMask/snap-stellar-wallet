import type { ComponentOrElement } from '@metamask/snaps-sdk';
import { Link, Text as SnapText } from '@metamask/snaps-sdk/jsx';

type AssetTextProps = {
  /** The link to the asset. if provided, the asset text will be a link. */
  link?: string;
  /** The asset text to display. */
  aseset: string;
};

/**
 * AssetText component for displaying assets with optional link.
 * Pure component with no business logic - just visual display.
 *
 * @param props - The props for the asset text component.
 * @returns The rendered asset text element.
 */
export const AssetText = (props: AssetTextProps): ComponentOrElement => {
  const { aseset, link } = props;
  if (link) {
    return <Link href={link}>{aseset}</Link>;
  }
  return <SnapText>${aseset}</SnapText>;
};
