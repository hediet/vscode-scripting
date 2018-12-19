
/*
find("test").replace(x => x.text);

declare interface Vars { }
declare var vars: Vars;

declare interface Vars { foo: string; }


type Arr_<T> = Arr<T> | Array<T>;

function selections(): Arr<HasRegion> {

}


function find(str: string|RegExp): Arr<Match> {

}

class Arr<T> {
    public replace(this: Arr<HasRegion>, f: (item: T) => string): void {}
    public select(this: Arr<HasRegion>): void {}

    public map<TNew>(f: (item: T, idx: number) => TNew) {

    }

    public filter(f: (item: T) => boolean): Arr<T> {}

}

interface HasRegion {
    region: Region;
}

class Selection implements HasRegion {
    public readonly region: Region;
    public readonly text: string;
}

class Match implements HasRegion {
    public readonly region: Region;
    public readonly text: string;
    public g(idx: number): string {

    }
}

interface Region {
    tag: "region";
    start: Position;
    end: Position;
}*/