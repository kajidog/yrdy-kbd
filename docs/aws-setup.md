# AWS設定手順

この手順は、このリポジトリの構成に合わせた Kinesis Video Streams with WebRTC の最小設定です。

- AWS認証情報は `apps/bff` の Go サーバーだけが持ちます。
- React の publisher/viewer には AWS access key / secret key を置きません。
- BFF が KVS signaling channel の作成、endpoint/ICE server 情報取得、WSS URL の SigV4 署名を行います。
- アプリが作る signaling channel 名は `yrdy-kbd-{roomId}` です。

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

BFF の AWS 実行主体に、`yrdy-kbd-*` の signaling channel だけを操作できる権限を付与します。

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
        "kinesisvideo:ConnectAsViewer"
      ],
      "Resource": "arn:aws:kinesisvideo:${AWS_REGION}:${AWS_ACCOUNT_ID}:channel/yrdy-kbd-*/*"
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

このアプリは room 作成時に `CreateSignalingChannel` を呼ぶので、事前に channel を作る必要はありません。

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

ブラウザで `http://localhost:5173` を開き、合言葉を入れて room を作成し、画面共有を開始します。表示された watch link を別タブまたは別端末で開き、同じ合言葉で視聴します。

## 6. 期待するAWS側の動き

room 作成時:

1. BFF が `DescribeSignalingChannel` で `yrdy-kbd-{roomId}` の存在確認をします。
2. なければ `CreateSignalingChannel` で作成します。
3. publisher/viewer session 作成時に `GetSignalingChannelEndpoint` と `GetIceServerConfig` を呼びます。
4. ブラウザの KVS SDK が signaling WSS へ接続するとき、BFF が `ConnectAsMaster` / `ConnectAsViewer` 用に署名済み URL を返します。

映像データは BFF を経由しません。KVS は signaling、STUN/TURN、接続補助を担当します。

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

- publisher が room 作成時に入力した合言葉と viewer の合言葉が違います。
- room 情報は BFF のメモリ保存なので、BFF を再起動すると既存 room は使えません。

viewer がつながらない

- KVS WebRTC は signaling channel あたり master は 1 接続、viewer は標準で最大 10 接続です。
- TURN 経由になるネットワークでは遅延や帯域制限の影響を受けます。

## 9. 後片付け

このサンプルは signaling channel を自動削除しません。不要になった channel は AWS Console か AWS CLI で削除します。

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

## 参考

- [Amazon Kinesis Video Streams with WebRTC: How it works](https://docs.aws.amazon.com/kinesisvideostreams-webrtc-dg/latest/devguide/kvswebrtc-how-it-works.html)
- [Create a signaling channel](https://docs.aws.amazon.com/kinesisvideostreams-webrtc-dg/latest/devguide/ingestion-create-channel.html)
- [GetIceServerConfig API](https://docs.aws.amazon.com/kinesisvideostreams/latest/APIReference/API_signaling_GetIceServerConfig.html)
- [ConnectAsMaster API](https://docs.aws.amazon.com/kinesisvideostreams-webrtc-dg/latest/devguide/ConnectAsMaster.html)
- [Kinesis Video Streams IAM actions](https://docs.aws.amazon.com/service-authorization/latest/reference/list_amazonkinesisvideostreams.html)
- [Kinesis Video Streams with WebRTC service quotas](https://docs.aws.amazon.com/kinesisvideostreams-webrtc-dg/latest/devguide/kvswebrtc-limits.html)
