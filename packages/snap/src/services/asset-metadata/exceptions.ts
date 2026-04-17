export class AssetMetadataServiceException extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AssetMetadataServiceException';
  }
}
