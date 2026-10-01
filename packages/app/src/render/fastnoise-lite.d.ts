// The parts of fastnoise-lite (Auburn's official JS port, untyped) that render/noise.ts drives.
declare module 'fastnoise-lite' {
  export default class FastNoiseLite {
    constructor(seed?: number);
    SetSeed(seed: number): void;
    SetFrequency(frequency: number): void;
    SetNoiseType(type: string): void;
    SetFractalType(type: string): void;
    SetFractalOctaves(octaves: number): void;
    SetFractalLacunarity(lacunarity: number): void;
    SetFractalGain(gain: number): void;
    SetFractalWeightedStrength(strength: number): void;
    SetFractalPingPongStrength(strength: number): void;
    SetCellularDistanceFunction(fn: string): void;
    SetCellularReturnType(type: string): void;
    SetCellularJitter(jitter: number): void;
    GetNoise(x: number, y: number): number;
    GetNoise(x: number, y: number, z: number): number;
  }
}
