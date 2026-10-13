/** Decodes stars.bin off the main thread (comlink). */
import { expose, transfer } from 'comlink';
import { decodeStarsBin, starDataBuffers, type StarData } from './format';

export interface StarsDecodeApi {
  decode(buf: ArrayBuffer): StarData;
}

const api: StarsDecodeApi = {
  decode(buf) {
    const d = decodeStarsBin(buf);
    return transfer(d, starDataBuffers(d));
  },
};

expose(api);
