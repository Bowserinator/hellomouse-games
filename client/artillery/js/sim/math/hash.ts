export const fnvOffsetBasis = 0x811c9dc5;
export const fnvPrime = 0x01000193;

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

    bytes(value: Uint8Array): this {
        for (let offset = 0; offset < value.length; offset++) this.byte(value[offset]);
        return this;
    }

    get value(): number {
        return this.checksum;
    }
}
