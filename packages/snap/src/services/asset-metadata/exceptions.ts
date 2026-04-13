export class AssetMetadataServiceException extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AssetMetadataServiceException';
  }
}

export class InvalidAssetReferenceException extends AssetMetadataServiceException {
  constructor(assetReference: string) {
    super(`Invalid asset reference: ${assetReference}`);
  }
}
