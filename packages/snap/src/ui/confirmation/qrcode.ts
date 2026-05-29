import qrCode from 'qrcode-generator';

// Constants for QR code generation
const QR_CODE_TYPE_NUMBER = 4;
const QR_CODE_CELL_SIZE = 5;
const QR_CODE_MARGIN = 16;
const QR_CODE_ERROR_CORRECTION_LEVEL = 'M';

/**
 * Generates a QR code for a Stellar address.
 *
 * @param address - The Stellar address to generate a QR code for.
 * @returns The SVG string of the QR code.
 */
export function generateAddressQrCode(address: string): string {
  const qr = qrCode(QR_CODE_TYPE_NUMBER, QR_CODE_ERROR_CORRECTION_LEVEL);
  qr.addData(address);
  qr.make();
  return qr.createSvgTag(QR_CODE_CELL_SIZE, QR_CODE_MARGIN);
}
