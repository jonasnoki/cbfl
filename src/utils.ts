export const concatStringSet = (
  stringSet: Set<string>,
  valueCallback: (inValue: string) => string = (inValue) => inValue,
  delimiter = ", "
): string => {
  let resultString = "";
  const values = stringSet.values();
  let next = values.next();
  while (!next.done) {
    resultString += valueCallback(next.value) + delimiter;
    next = values.next();
  }
  return resultString;
};
