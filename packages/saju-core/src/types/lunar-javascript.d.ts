// lunar-javascript 는 타입 선언을 제공하지 않으므로 엔진에서 사용하는 부분만 최소 선언한다.
declare module 'lunar-javascript' {
  interface LunarSolar {
    getYear(): number;
    getMonth(): number;
    getDay(): number;
    getHour(): number;
    getMinute(): number;
    getSecond(): number;
    toYmdHms(): string;
    getLunar(): LunarLunar;
  }
  interface LunarEightChar {
    getYear(): string;
    getMonth(): string;
    getDay(): string;
    getTime(): string;
  }
  interface LunarLunar {
    getJieQiTable(): Record<string, LunarSolar>;
    getEightChar(): LunarEightChar;
    // 택일 교차 검증(test/taekil.test.ts)용
    getMonthZhi(): string;
    getZhiXing(): string;
    getDayTianShen(): string;
    getDayTianShenType(): string;
    getTimeTianShenType(): string;
    getDayJiShen(): string[];
    getDayXiongSha(): string[];
    getDayYi(): string[];
    getDayJi(): string[];
  }
  export const Solar: {
    fromYmd(year: number, month: number, day: number): LunarSolar;
    fromYmdHms(year: number, month: number, day: number, hour: number, minute: number, second: number): LunarSolar;
  };
}
