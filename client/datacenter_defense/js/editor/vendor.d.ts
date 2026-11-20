type ClipRing = Array<[number, number]>;
type ClipPolygon = Array<ClipRing>;
type ClipMultiPolygon = Array<ClipPolygon>;
declare const polygonClipping: {
    difference(
        subject: ClipPolygon | ClipMultiPolygon, ...clips: Array<ClipPolygon | ClipMultiPolygon>
    ): ClipMultiPolygon;
    intersection(
        subject: ClipPolygon | ClipMultiPolygon, ...clips: Array<ClipPolygon | ClipMultiPolygon>
    ): ClipMultiPolygon;
};
