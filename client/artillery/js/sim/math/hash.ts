export const fnvOffsetBasis = 0x811c9dc5;
export const fnvPrime = 0x01000193;

const isLittleEndian = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1;

export class StateHash {
    private checksum = fnvOffsetBasis;
    private numberBuffer = new DataView(new ArrayBuffer(8));

    byte(value: number): this {
        this.checksum = Math.imul(this.checksum ^ (value & 255), fnvPrime) >>> 0;
        return this;
    }

    unsignedInteger(value: number): this {
        for (let shift = 0; shift < 32; shift += 8) this.byte(value >>> shift);
        return this;
    }

    number(value: number): this {
        this.numberBuffer.setFloat64(0, value, true);
        for (let offset = 0; offset < 8; offset++) this.byte(this.numberBuffer.getUint8(offset));
        return this;
    }

    string(value: string): this {
        this.unsignedInteger(value.length);
        for (let offset = 0; offset < value.length; offset++) {
            const code = value.charCodeAt(offset);
            this.byte(code).byte(code >>> 8);
        }
        return this;
    }

    /** Hashes bulk data a word at a time. */
    bytes(value: Uint8Array): this {
        const wordCount = value.length >>> 2;
        const words = isLittleEndian && value.byteOffset % 4 === 0
            ? new Uint32Array(value.buffer, value.byteOffset, wordCount) : null;
        let checksum = this.checksum;
        for (let index = 0; index < wordCount; index++) {
            const offset = index << 2;
            let word = words ? words[index] : (value[offset] | value[offset + 1] << 8 |
                value[offset + 2] << 16 | value[offset + 3] << 24);
            word = Math.imul(word, 0xcc9e2d51);
            word = Math.imul(word << 15 | word >>> 17, 0x1b873593);
            checksum ^= word;
            checksum = Math.imul(checksum << 13 | checksum >>> 19, 5) + 0xe6546b64 | 0;
        }
        this.checksum = checksum >>> 0;
        for (let offset = wordCount << 2; offset < value.length; offset++) this.byte(value[offset]);
        return this;
    }

    get value(): number {
        return this.checksum;
    }
}
