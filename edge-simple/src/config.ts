// Lambda@Edge は環境変数が使えないので、値はここに直接書く。
// REPLACE_ME が残っていると npm run build が失敗する。
export const USER_POOL_ID = "REPLACE_ME";

export const CLIENT_IDS = {
  mobi: "REPLACE_ME",
  pc: "REPLACE_ME",
  cliApi: "REPLACE_ME",
};
