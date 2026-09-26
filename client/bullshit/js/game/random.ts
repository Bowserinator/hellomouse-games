export default {
    /**
     * Rand int between [a, b)
     * @param {number} a
     * @param {number} b
     * @return {number} random number
     */
    randInt: (a: number, b: number): number => {
        return Math.floor(Math.random() * (b - a) + a);
    }
};
