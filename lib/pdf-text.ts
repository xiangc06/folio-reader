type TextItem = {str:string; hasEOL:boolean; transform:number[]; width:number; height:number; dir:string};
export function joinPDFText(items: Array<TextItem | object>): string {
  let result = '', previous: TextItem | undefined;
  for (const item of items) {
    if (!('str' in item)) continue;
    const current = item as TextItem;
    if (previous && !/\s$/.test(result) && !/^\s/.test(current.str)) {
      const verticalGap = Math.abs(current.transform[5] - previous.transform[5]);
      const horizontalGap = current.transform[4] - (previous.transform[4] + previous.width);
      if (verticalGap > Math.max(2, previous.height * .4)) result += '\n';
      else if (current.dir === 'rtl' || horizontalGap > Math.max(.5, previous.height * .08)) result += ' ';
    }
    result += current.str + (current.hasEOL ? '\n' : '');
    previous = current;
  }
  return result;
}
