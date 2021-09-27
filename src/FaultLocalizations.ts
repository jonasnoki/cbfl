import * as fs from "fs";

interface IFaultyFile {
  path: string;
  lines: Map<number, Set<string>>; // lineNumber => Set of faultyFiles
  statements: Map<number, Set<string>>; // statementID => Set of faultyFiles
  functions: Map<number, Set<string>>; // functionID => Set of faultyFiles
  functionMap: Map<number, IFunctionInformation>; // functionID => function Information
  // statementMap: Map<string, Set<string>>;
}

interface IFunctionInformation {
  start: ILocation;
  end: ILocation;
  name: string;
}

interface ILocation {
  line: number;
  column: number;
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
    const functionMap = this.createFunctionMap(coverage);
    const faultyFile: IFaultyFile = {
      path: coverage.path,
      lines: new Map(
        Object.keys(coverage.s).map((statementNumber) => [
          parseInt(statementNumber) + 1,
          new Set(),
        ]) // the line numbers that are put out are just the statements
      ),
      statements: new Map(
        Object.keys(coverage.s).map((statementNumber) => [
          parseInt(statementNumber),
          new Set(),
        ])
      ),
      functions: new Map(
        Object.keys(coverage.f).map((functionID) => [
          parseInt(functionID),
          new Set(),
        ])
      ),
      functionMap,
    };
    this.faultyFiles.set(changedLineCoveragePath, faultyFile);
    return faultyFile;
  }

  private createFunctionMap(coverage: any): Map<number, IFunctionInformation> {
    return new Map(
      Object.keys(coverage.fnMap).map((functionID) => {
        const info = coverage.fnMap[functionID];
        return [
          parseInt(functionID),
          { start: info.decl.start, end: info.decl.end, name: info.name },
        ];
      })
    );
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
    faultyFile.lines.get(lineNumber)?.add(failedTestPath);
    faultyFile.statements.get(lineNumber - 1)?.add(failedTestPath);
    faultyFile.functions
      .get(this.getFunctionIDForLineNumber(lineNumber, faultyFile))
      ?.add(failedTestPath);
  }

  private getFunctionIDForLineNumber(
    lineNumber: number,
    faultyFile: IFaultyFile
  ): number {
    let functionID = -1;
    faultyFile.functionMap.forEach(
      (info, id) =>
        (functionID =
          lineNumber >= info.start.line && lineNumber <= info.end.line
            ? id
            : functionID)
    );
    return functionID;
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
          const failedTestsPaths: string[] = [...failedTests];
          const failedTestsDescriptions: string[] = failedTestsPaths.map(
            (failedTestPath: string) =>
              `<li>**${
                this.failedTests.get(failedTestPath)?.name || ""
              }** (${failedTestPath})</li>`
          );
          const failedTestsBlock: string = failedTestsDescriptions.reduce(
            (prev, curr) => prev + curr,
            ""
          );
          comment += `The failed Tests <ul> ${failedTestsBlock} </ul> ran through the **line ${lineNumber}** of the file ${faultyFilePath} which was recently changed.`;

          console.log(failedTestsPaths);
        }
      }
    }
    return comment;
  }

  public async saveToFile(commitID: string): Promise<void> {
    const data = {
      faultyFiles: this.faultyFiles,
      failedTests: this.failedTests,
    };

    const serialized = JSON.stringify(data, FaultLocalizations.replacer);
    const path = "./faultLocalizations";
    const filePath = `${path}/${commitID}.json`;
    fs.mkdir(path, { recursive: true }, function (err) {
      if (err) return console.log(err);

      return fs.promises.writeFile(filePath, serialized, "utf8");
    });
    return Promise.resolve();
  }

  private static replacer(key: any, value: any): any {
    if (value instanceof Map) {
      return {
        dataType: "Map",
        value: Array.from(value.entries()), // or with spread: value: [...value]
      };
    } else if (value instanceof Set) {
      return {
        dataType: "Set",
        value: Array.from(value.values()), // or with spread: value: [...value]
      };
    } else {
      return value;
    }
  }

  private static reviver(key: any, value: any): any {
    if (typeof value === "object" && value !== null) {
      if (value.dataType === "Map") {
        return new Map(value.value);
      }
      if (value.dataType === "Set") {
        return new Set(value.value);
      }
    }
    return value;
  }
}
