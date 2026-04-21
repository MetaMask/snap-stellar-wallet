import { array, object, union } from '@metamask/superstruct';

import {
  KnownCaip19ClassicAssetStruct,
  KnownCaip19Sep41AssetStruct,
  KnownCaip19Slip44IdStruct,
} from '../../api';

export const OnAssetsLookupAssetStruct = union([
  KnownCaip19ClassicAssetStruct,
  KnownCaip19Slip44IdStruct,
  KnownCaip19Sep41AssetStruct,
]);

export const OnAssetsLookupRequestStruct = object({
  assets: array(OnAssetsLookupAssetStruct),
});
