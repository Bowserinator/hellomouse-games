/**
 * Adapted from the tutorial BufferLoader class
 * @see https://middleearmedia.com/web-audio-api-bufferloader/
 */
export default class BufferLoader {
    context: AudioContext;
    urlList: Array<string>;
    onload: (buffers: Array<AudioBuffer>) => void;
    bufferList: Array<AudioBuffer>;
    loadCount: number;

    /**
     * Construct a BufferLoader
     * @param context Audio context
     * @param urlList List of srcs to load
     * @param callback Callback, returns buffers
     */
    constructor(context: AudioContext, urlList: Array<string>, callback: (buffers: Array<AudioBuffer>) => void) {
        this.context = context;
        this.urlList = urlList;
        this.onload = callback;
        this.bufferList = [];
        this.loadCount = 0;
    }

    /**
     * Load a singular buffer item
     * @param url src to load
     * @param index Index in the array
     */
    loadBuffer(url: string, index: number) {
        // Load buffer asynchronously
        let request = new XMLHttpRequest();
        request.open('GET', url, true);
        request.responseType = 'arraybuffer';

        // eslint-disable-next-line @typescript-eslint/no-this-alias
        let loader = this;

        request.onload = () => {
            // Asynchronously decode the audio file data in request.response
            loader.context.decodeAudioData(
                request.response,
                buffer => {
                    if (!buffer) {
                        console.error('Error decoding file data: ' + url);
                        return;
                    }
                    loader.bufferList[index] = buffer;
                    if (++loader.loadCount === loader.urlList.length)
                        loader.onload(loader.bufferList);
                },
                error => {
                    console.error('decodeAudioData error', error);
                }
            );
        };
        request.onerror = () => {
            console.error('BufferLoader: XHR error');
        };
        request.send();
    }

    /** Load all buffer items */
    load() {
        for (let i = 0; i < this.urlList.length; ++i)
            this.loadBuffer(this.urlList[i], i);
    }
}
