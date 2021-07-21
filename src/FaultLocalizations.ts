import { concatStringSet } from "./utils";

interface IFaultyFile {
  path: string;
  lines: Map<string, Set<string>>;
  statements: Map<string, Set<string>>;
  functionMap: Map<string, Set<string>>;
  statementMap: Map<string, Set<string>>;
  branchMap: Map<string, Set<string>>;
}

interface IFailedTest {
  name: string;
}

export class FaultLocalizations {
  faultyFiles: Map<string, IFaultyFile> = new Map();
  failedTests: Map<string, IFailedTest> = new Map();

  public getOrCreateFaultyFile(
    coverage: any,
    changedLineCoveragePath: string
  ): IFaultyFile {
    return (
      this.faultyFiles.get(changedLineCoveragePath) ||
      this.createFaultyFile(coverage, changedLineCoveragePath)
    );
  }

  public createFaultyFile(
    coverage: any,
    changedLineCoveragePath: string
  ): IFaultyFile {
    const faultyFile: IFaultyFile = {
      path: coverage.path,
      lines: new Map(
        Object.keys(coverage.s).map((key) => [
          parseInt(key) + 1 + "",
          new Set(),
        ])
      ),
      statements: new Map(
        Object.keys(coverage.s).map((key) => [key, new Set()])
      ),
      // branches: new Map(Object.keys(coverage.b).map(key => [key, new Set()])),
      // functions: new Map(Object.keys(coverage.f).map(key => [key, new Set()])),
      functionMap: coverage.fnMap,
      statementMap: coverage.statementMap,
      branchMap: coverage.branchMap,
    };
    this.faultyFiles.set(changedLineCoveragePath, faultyFile);
    return faultyFile;
  }

  public addFailedTest(path: string, name: string): void {
    this.failedTests.set(path, { name });
  }

  public addFailedLine(
    coverage: any,
    changedLineCoveragePath: string,
    lineNumber: number,
    failedTestPath: string
  ): void {
    const faultyFile = this.getOrCreateFaultyFile(
      coverage,
      changedLineCoveragePath
    );
    faultyFile.lines.get("" + lineNumber)?.add(failedTestPath);
    faultyFile.statements.get("" + (lineNumber - 1))?.add(failedTestPath);
    // faultyFile.branchesMap
    // faultyFile.branches.get(lineNumber).add(failedTestPath)
    // faultyFile.lines.get(lineNumber).add(failedTestPath)
  }

  public generateComment() {
    let comment = "";
    for (const [faultyFilePath, faultyFile] of this.faultyFiles) {
      for (const [lineNumber, failedTests] of faultyFile.lines) {
        if (failedTests.size === 1) {
          const failedTestPath = failedTests.values().next().value;
          comment += `\nThe failed Test ${
            this.failedTests.get(failedTestPath)?.name
          } from the file "${failedTestPath}" ran through the line ${lineNumber} of the file ${faultyFilePath} which was changed recently changed.`;
        } else if (failedTests.size > 1) {
          const failedTestsPaths = concatStringSet(failedTests);
          const failedTestsNames = concatStringSet(
            failedTests,
            (inValue: string) => this.failedTests.get(inValue)?.name || ""
          );
          comment += `\nThe failed Tests ${failedTestsNames} from the files "${failedTestsPaths}" ran through the line ${lineNumber} of the file ${faultyFilePath} which was changed recently changed.`;

          console.log(failedTestsPaths);
        }
      }
    }
    return comment;
  }
}