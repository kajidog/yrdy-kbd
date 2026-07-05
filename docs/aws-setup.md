# AWS設定手順

この手順は、このリポジトリの構成に合わせた Kinesis Video Streams with WebRTC + 録画(メディア取り込み)+ Cognito 認証の最小設定です。

- AWS認証情報は `apps/bff` の Go サーバーだけが持ちます。
- React の publisher/viewer には AWS access key / secret key を置きません。
- BFF が KVS signaling channel / stream の作成、endpoint/ICE server 情報取得、WSS URL の SigV4 署名、録画セッション開始(`JoinStorageSession`)、HLS 再生 URL の発行を行います。
- アプリが作る signaling channel 名 / stream 名は `yrdy-kbd-{liveId}` です。
- フロントは Cognito でログインし、ID トークンを `Authorization: Bearer` で BFF に送ります。トークンの署名・発行元検証は CloudFront + Lambda@Edge で行う前提のため、BFF はペイロードのデコードのみ行います(ローカル開発では Cognito 未設定の dev モードで動作可)。

## 1. 前提ツール

```sh
aws --version
go version
node --version
npm --version
```

AWS CLI が未設定なら、まず AWS CLI の認証を設定します。ローカル開発では IAM Identity Center / SSO profile を推奨します。

```sh
aws configure sso
aws sso login --profile your-profile
aws sts get-caller-identity --profile your-profile
```

長期 access key を使う場合は `aws configure --profile your-profile` でも動きますが、業務利用では SSO や一時認証情報を優先してください。

## 2. リージョンを決める

例では東京リージョンを使います。

```sh
export AWS_REGION=ap-northeast-1
export AWS_PROFILE=your-profile
export AWS_ACCOUNT_ID=$(aws sts get-caller-identity --profile "$AWS_PROFILE" --query Account --output text)
```

BFF、KVS signaling channel、publisher/viewer の接続先リージョンは同じにします。

## 3. IAMポリシーを作る

BFF の AWS 実行主体に、`yrdy-kbd-*` の signaling channel と stream だけを操作できる権限を付与します。

```sh
cat > /tmp/yrdy-kbd-kvs-webrtc-policy.json <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowYrdyKbdKVSWebRTC",
      "Effect": "Allow",
      "Action": [
        "kinesisvideo:CreateSignalingChannel",
        "kinesisvideo:DescribeSignalingChannel",
        "kinesisvideo:GetSignalingChannelEndpoint",
        "kinesisvideo:GetIceServerConfig",
        "kinesisvideo:ConnectAsMaster",
        "kinesisvideo:ConnectAsViewer",
        "kinesisvideo:UpdateMediaStorageConfiguration",
        "kinesisvideo:DescribeMediaStorageConfiguration",
        "kinesisvideo:JoinStorageSession"
      ],
      "Resource": "arn:aws:kinesisvideo:${AWS_REGION}:${AWS_ACCOUNT_ID}:channel/yrdy-kbd-*/*"
    },
    {
      "Sid": "AllowYrdyKbdKVSStreams",
      "Effect": "Allow",
      "Action": [
        "kinesisvideo:CreateStream",
        "kinesisvideo:DescribeStream",
        "kinesisvideo:GetDataEndpoint",
        "kinesisvideo:GetHLSStreamingSessionURL"
      ],
      "Resource": "arn:aws:kinesisvideo:${AWS_REGION}:${AWS_ACCOUNT_ID}:stream/yrdy-kbd-*/*"
    }
  ]
}
EOF

aws iam create-policy \
  --profile "$AWS_PROFILE" \
  --policy-name YrdyKbdKVSWebRTCDev \
  --policy-document file:///tmp/yrdy-kbd-kvs-webrtc-policy.json
```

既存の role/user に attach します。

IAM role に付ける場合:

```sh
aws iam attach-role-policy \
  --profile "$AWS_PROFILE" \
  --role-name YOUR_ROLE_NAME \
  --policy-arn "arn:aws:iam::${AWS_ACCOUNT_ID}:policy/YrdyKbdKVSWebRTCDev"
```

IAM user に付ける場合:

```sh
aws iam attach-user-policy \
  --profile "$AWS_PROFILE" \
  --user-name YOUR_USER_NAME \
  --policy-arn "arn:aws:iam::${AWS_ACCOUNT_ID}:policy/YrdyKbdKVSWebRTCDev"
```

このアプリはライブ作成時に `CreateSignalingChannel`(録画有効時は `CreateStream` と `UpdateMediaStorageConfiguration` も)を呼ぶので、事前に channel / stream を作る必要はありません。

## 3.5 Cognito user pool を作る(任意)

ローカル開発だけなら省略できます(フロントの `VITE_COGNITO_*` を空にすると dev モードで動きます)。実際に Cognito ログインを使う場合:

```sh
aws cognito-idp create-user-pool \
  --profile "$AWS_PROFILE" \
  --pool-name yrdy-kbd-users \
  --auto-verified-attributes email \
  --username-attributes email \
  --query 'UserPool.Id' --output text
# => ap-northeast-1_XXXXXXXXX

aws cognito-idp create-user-pool-client \
  --profile "$AWS_PROFILE" \
  --user-pool-id ap-northeast-1_XXXXXXXXX \
  --client-name yrdy-kbd-web \
  --no-generate-secret \
  --explicit-auth-flows ALLOW_USER_PASSWORD_AUTH ALLOW_REFRESH_TOKEN_AUTH \
  --query 'UserPoolClient.ClientId' --output text
```

取得した pool ID と client ID を `apps/publisher/.env` と `apps/viewer/.env` の `VITE_COGNITO_USER_POOL_ID` / `VITE_COGNITO_CLIENT_ID` に設定します。フロントは `USER_PASSWORD_AUTH` でサインイン/サインアップ/確認コード入力を行います。

本番構成ではトークンの署名・発行元検証を CloudFront + Lambda@Edge で行い、BFF には検証済みリクエストだけが届く前提です。BFF は `Authorization` ヘッダーの JWT ペイロードから `sub` と `cognito:username` を読むだけで、署名検証はしません。

## 4. BFFを起動する

Go BFF は `.env` を自動では読み込みません。環境変数を export して起動します。

```sh
cd apps/bff
cp .env.example .env

set -a
source .env
set +a

export AWS_PROFILE=your-profile
go run .
```

別 shell で health check します。

```sh
curl http://localhost:8080/healthz
```

`{"status":"ok"}` が返れば BFF は起動しています。AWS 認証エラーは room 作成時に出ます。

## 5. Reactアプリを起動する

publisher:

```sh
cd apps/publisher
cp .env.example .env
npm install
npm run dev -- --port 5173
```

viewer:

```sh
cd apps/viewer
cp .env.example .env
npm install
npm run dev -- --port 5174
```

ブラウザで `http://localhost:5173` を開いてログインし(dev モードでは任意のユーザー名)、タイトル・合言葉(任意)・公開設定・録画設定を入れてライブを作成し、Go live で画面共有を開始します。`http://localhost:5174` を別タブまたは別端末で開いてログインし、検索または watch link からライブを視聴します。録画付きライブを停止すると "Past broadcasts" に載り、HLS で再生できます。

## 6. 期待するAWS側の動き

ライブ作成時:

1. BFF が `DescribeSignalingChannel` で `yrdy-kbd-{liveId}` の存在確認をします。
2. なければ `CreateSignalingChannel` で作成します。
3. 録画有効なら `CreateStream` で stream を作成し、`UpdateMediaStorageConfiguration` で channel に紐付けます。
4. publisher/viewer session 作成時に `GetSignalingChannelEndpoint` と `GetIceServerConfig` を呼びます。
5. ブラウザの KVS SDK が signaling WSS へ接続するとき、BFF が `ConnectAsMaster` / `ConnectAsViewer` 用に署名済み URL を返します。

配信・録画中:

1. publisher の master が signaling に接続すると、BFF が `JoinStorageSession` を呼びます。
2. KVS が録画ピアとして SDP offer を master に送り、master が応答した映像・音声が stream にアーカイブされます(メディア取り込みは音声トラック必須のため、画面共有に音声がない場合 publisher が無音トラックを追加します)。

再生時:

1. BFF が `GetDataEndpoint` で archived-media エンドポイントを取得します。
2. `GetHLSStreamingSessionURL` で HLS URL を発行します。配信中は `LIVE`、終了後はライブの開始/終了時刻を範囲にした `ON_DEMAND` です。

映像データは BFF を経由しません。KVS は signaling、STUN/TURN、録画、HLS 配信を担当します。

## 7. 動作確認コマンド

```sh
cd apps/bff
go test ./...
```

```sh
cd apps/publisher
npm run lint
npm run build
```

```sh
cd apps/viewer
npm run lint
npm run build
```

## 8. よくあるエラー

`AWS_REGION is required`

- `AWS_REGION` が BFF 起動 shell に export されていません。

`prepare KVS signaling channel`

- BFF が AWS API 呼び出しに失敗しています。
- `AWS_PROFILE`、SSO login、IAM policy、リージョンを確認してください。

`passphrase does not match`

- ライブ作成時に設定した合言葉と viewer の入力が違います(合言葉なしのライブは誰でも視聴できます)。
- ライブ情報は `BFF_DATA_FILE`(既定 `apps/bff/data/lives.json`)に永続化されるため、BFF を再起動しても過去の配信は残ります。再起動時に配信中だったライブは `ended` になります。

録画が再生できない

- `Record` を有効にしてライブを作成したか確認してください。
- KVS のメディア取り込みは H.264 映像 + Opus 音声が必須です。ブラウザが H.264 で送出しているか確認してください。
- stream の保持時間は `KVS_RETENTION_HOURS`(既定 72 時間)です。それを過ぎた録画は再生できません。

viewer がつながらない

- KVS WebRTC は signaling channel あたり master は 1 接続、viewer は標準で最大 10 接続です。
- TURN 経由になるネットワークでは遅延や帯域制限の影響を受けます。

## 9. 後片付け

このサンプルは signaling channel / stream を自動削除しません。不要になったものは AWS Console か AWS CLI で削除します。

一覧:

```sh
aws kinesisvideo list-signaling-channels \
  --profile "$AWS_PROFILE" \
  --region "$AWS_REGION" \
  --channel-name-condition ComparisonOperator=BEGINS_WITH,ComparisonValue=yrdy-kbd-
```

削除は channel ARN を指定します。

```sh
aws kinesisvideo delete-signaling-channel \
  --profile "$AWS_PROFILE" \
  --region "$AWS_REGION" \
  --channel-arn "arn:aws:kinesisvideo:${AWS_REGION}:${AWS_ACCOUNT_ID}:channel/yrdy-kbd-xxxxxxxxxxxxxxxx/1234567890123"
```

録画用 stream の一覧と削除:

```sh
aws kinesisvideo list-streams \
  --profile "$AWS_PROFILE" \
  --region "$AWS_REGION" \
  --stream-name-condition ComparisonOperator=BEGINS_WITH,ComparisonValue=yrdy-kbd-

aws kinesisvideo delete-stream \
  --profile "$AWS_PROFILE" \
  --region "$AWS_REGION" \
  --stream-arn "arn:aws:kinesisvideo:${AWS_REGION}:${AWS_ACCOUNT_ID}:stream/yrdy-kbd-xxxxxxxxxxxxxxxx/1234567890123"
```

## 参考

- [Amazon Kinesis Video Streams with WebRTC: How it works](https://docs.aws.amazon.com/kinesisvideostreams-webrtc-dg/latest/devguide/kvswebrtc-how-it-works.html)
- [Create a signaling channel](https://docs.aws.amazon.com/kinesisvideostreams-webrtc-dg/latest/devguide/ingestion-create-channel.html)
- [GetIceServerConfig API](https://docs.aws.amazon.com/kinesisvideostreams/latest/APIReference/API_signaling_GetIceServerConfig.html)
- [ConnectAsMaster API](https://docs.aws.amazon.com/kinesisvideostreams-webrtc-dg/latest/devguide/ConnectAsMaster.html)
- [Kinesis Video Streams IAM actions](https://docs.aws.amazon.com/service-authorization/latest/reference/list_amazonkinesisvideostreams.html)
- [Kinesis Video Streams with WebRTC service quotas](https://docs.aws.amazon.com/kinesisvideostreams-webrtc-dg/latest/devguide/kvswebrtc-limits.html)
- [WebRTC ingestion and storage](https://docs.aws.amazon.com/kinesisvideostreams-webrtc-dg/latest/devguide/webrtc-ingestion.html)
- [JoinStorageSession API](https://docs.aws.amazon.com/kinesisvideostreams/latest/APIReference/API_webrtc_JoinStorageSession.html)
- [GetHLSStreamingSessionURL API](https://docs.aws.amazon.com/kinesisvideostreams/latest/APIReference/API_reader_GetHLSStreamingSessionURL.html)
- [Amazon Cognito user pools](https://docs.aws.amazon.com/cognito/latest/developerguide/cognito-user-identity-pools.html)
