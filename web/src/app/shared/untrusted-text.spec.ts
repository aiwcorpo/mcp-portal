import { neutraliseText } from './untrusted-text';

describe('neutraliseText written markers', () => {
  it('flags a value in which the BFF already wrote a neutralised character', () => {
    expect(neutraliseText('a<U+202E>b')).toEqual({ text: 'a<U+202E>b', neutralised: true });
    expect(neutraliseText('<U+1F600> and <U+12>')).toEqual({
      text: '<U+1F600> and <U+12>',
      neutralised: true,
    });
    expect(neutraliseText('<U+12>').neutralised).toBe(false);
  });
});
