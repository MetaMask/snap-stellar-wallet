import { ConfirmationInterfaceKey } from './api';
import { ConfirmationUXController } from './controller';
import { KnownCaip2ChainId } from '../../api';
import { noOpLogger } from '../../utils/logger';

describe('ConfirmationUXController', () => {
  it('throws when transaction scanning is enabled without a security scan request', async () => {
    const controller = new ConfirmationUXController({ logger: noOpLogger });

    await expect(
      controller.renderConfirmationDialog({
        scope: KnownCaip2ChainId.Mainnet,
        interfaceKey: ConfirmationInterfaceKey.SignTransaction,
        fee: '100',
        renderContext: {},
        renderOptions: { securityScanning: true },
      }),
    ).rejects.toThrow(
      'Cannot scan a transaction confirmation without a security scan request.',
    );
  });
});
