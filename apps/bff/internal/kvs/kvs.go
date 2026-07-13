package kvs

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/kinesisvideo"
	kvtypes "github.com/aws/aws-sdk-go-v2/service/kinesisvideo/types"
	"github.com/aws/aws-sdk-go-v2/service/kinesisvideoarchivedmedia"
	hlstypes "github.com/aws/aws-sdk-go-v2/service/kinesisvideoarchivedmedia/types"
	"github.com/aws/aws-sdk-go-v2/service/kinesisvideosignaling"
	sigtypes "github.com/aws/aws-sdk-go-v2/service/kinesisvideosignaling/types"
	"github.com/aws/aws-sdk-go-v2/service/kinesisvideowebrtcstorage"
)

type Role string

const (
	RoleMaster Role = "MASTER"
	RoleViewer Role = "VIEWER"
)

type EndpointSet struct {
	WSS   string `json:"wss"`
	HTTPS string `json:"https"`
}

type ICEServer struct {
	URLs       []string `json:"urls"`
	Username   string   `json:"username,omitempty"`
	Credential string   `json:"credential,omitempty"`
	TTL        int32    `json:"ttl,omitempty"`
}

type SessionConfig struct {
	Role       Role        `json:"role"`
	Region     string      `json:"region"`
	ChannelARN string      `json:"channelArn"`
	Endpoints  EndpointSet `json:"endpoints"`
	ICEServers []ICEServer `json:"iceServers"`
}

type SessionInput struct {
	ChannelARN string
	Role       Role
	ClientID   string
}

type SignalingURLInput struct {
	Endpoint    string
	QueryParams map[string]string
}

type HLSPlaybackInput struct {
	StreamARN string
	// Live selects LIVE playback (broadcast still running); otherwise the
	// recording between Start and End is served ON_DEMAND.
	Live  bool
	Start time.Time
	End   time.Time
}

type Client interface {
	EnsureSignalingChannel(ctx context.Context, channelName string) (string, error)
	SessionConfig(ctx context.Context, input SessionInput) (SessionConfig, error)
	SignalingURL(ctx context.Context, input SignalingURLInput) (string, error)
	EnsureStream(ctx context.Context, streamName string) (string, error)
	ConfigureMediaStorage(ctx context.Context, channelARN, streamARN string) error
	JoinStorageSession(ctx context.Context, channelARN string) error
	HLSPlaybackURL(ctx context.Context, input HLSPlaybackInput) (string, error)
}

type AWSClient struct {
	region         string
	retentionHours int32
	cfg            aws.Config
	video          *kinesisvideo.Client
}

func NewAWSClient(ctx context.Context, region string, retentionHours int32) (*AWSClient, error) {
	cfg, err := config.LoadDefaultConfig(ctx, config.WithRegion(region))
	if err != nil {
		return nil, fmt.Errorf("load AWS config: %w", err)
	}
	return &AWSClient{
		region:         region,
		retentionHours: retentionHours,
		cfg:            cfg,
		video:          kinesisvideo.NewFromConfig(cfg),
	}, nil
}

func (c *AWSClient) EnsureSignalingChannel(ctx context.Context, channelName string) (string, error) {
	described, err := c.video.DescribeSignalingChannel(ctx, &kinesisvideo.DescribeSignalingChannelInput{
		ChannelName: aws.String(channelName),
	})
	if err == nil {
		if described.ChannelInfo == nil || described.ChannelInfo.ChannelARN == nil {
			return "", fmt.Errorf("describe signaling channel returned no ARN")
		}
		return *described.ChannelInfo.ChannelARN, nil
	}
	if !isKVSNotFound(err) {
		return "", fmt.Errorf("describe signaling channel: %w", err)
	}

	created, err := c.video.CreateSignalingChannel(ctx, &kinesisvideo.CreateSignalingChannelInput{
		ChannelName: aws.String(channelName),
		ChannelType: kvtypes.ChannelTypeSingleMaster,
	})
	if err != nil {
		return "", fmt.Errorf("create signaling channel: %w", err)
	}
	if created.ChannelARN == nil {
		return "", fmt.Errorf("create signaling channel returned no ARN")
	}
	return *created.ChannelARN, nil
}

func (c *AWSClient) SessionConfig(ctx context.Context, input SessionInput) (SessionConfig, error) {
	role, err := input.Role.awsChannelRole()
	if err != nil {
		return SessionConfig{}, err
	}

	endpointOut, err := c.video.GetSignalingChannelEndpoint(ctx, &kinesisvideo.GetSignalingChannelEndpointInput{
		ChannelARN: aws.String(input.ChannelARN),
		SingleMasterChannelEndpointConfiguration: &kvtypes.SingleMasterChannelEndpointConfiguration{
			Protocols: []kvtypes.ChannelProtocol{kvtypes.ChannelProtocolWss, kvtypes.ChannelProtocolHttps},
			Role:      role,
		},
	})
	if err != nil {
		return SessionConfig{}, fmt.Errorf("get signaling channel endpoints: %w", err)
	}

	endpoints, err := endpointSetFromKVS(endpointOut.ResourceEndpointList)
	if err != nil {
		return SessionConfig{}, err
	}

	signaling := kinesisvideosignaling.NewFromConfig(c.cfg, func(o *kinesisvideosignaling.Options) {
		o.BaseEndpoint = aws.String(endpoints.HTTPS)
	})
	iceInput := &kinesisvideosignaling.GetIceServerConfigInput{
		ChannelARN: aws.String(input.ChannelARN),
		Service:    sigtypes.ServiceTurn,
	}
	if input.Role == RoleViewer {
		iceInput.ClientId = aws.String(input.ClientID)
	}
	iceOut, err := signaling.GetIceServerConfig(ctx, iceInput)
	if err != nil {
		return SessionConfig{}, fmt.Errorf("get ICE server config: %w", err)
	}

	return SessionConfig{
		Role:       input.Role,
		Region:     c.region,
		ChannelARN: input.ChannelARN,
		Endpoints:  endpoints,
		ICEServers: iceServersFromKVS(c.region, iceOut.IceServerList),
	}, nil
}

// EnsureStream creates (or reuses) the KVS video stream that WebRTC media
// ingestion records into, and returns its ARN.
func (c *AWSClient) EnsureStream(ctx context.Context, streamName string) (string, error) {
	described, err := c.video.DescribeStream(ctx, &kinesisvideo.DescribeStreamInput{
		StreamName: aws.String(streamName),
	})
	if err == nil {
		if described.StreamInfo == nil || described.StreamInfo.StreamARN == nil {
			return "", fmt.Errorf("describe stream returned no ARN")
		}
		return *described.StreamInfo.StreamARN, nil
	}
	if !isKVSNotFound(err) {
		return "", fmt.Errorf("describe stream: %w", err)
	}

	created, err := c.video.CreateStream(ctx, &kinesisvideo.CreateStreamInput{
		StreamName:           aws.String(streamName),
		DataRetentionInHours: aws.Int32(c.retentionHours),
	})
	if err != nil {
		return "", fmt.Errorf("create stream: %w", err)
	}
	if created.StreamARN == nil {
		return "", fmt.Errorf("create stream returned no ARN")
	}
	return *created.StreamARN, nil
}

// ConfigureMediaStorage links the signaling channel to the stream so KVS
// records the master's WebRTC media into it.
func (c *AWSClient) ConfigureMediaStorage(ctx context.Context, channelARN, streamARN string) error {
	_, err := c.video.UpdateMediaStorageConfiguration(ctx, &kinesisvideo.UpdateMediaStorageConfigurationInput{
		ChannelARN: aws.String(channelARN),
		MediaStorageConfiguration: &kvtypes.MediaStorageConfiguration{
			Status:    kvtypes.MediaStorageConfigurationStatusEnabled,
			StreamARN: aws.String(streamARN),
		},
	})
	if err != nil {
		return fmt.Errorf("update media storage configuration: %w", err)
	}
	return nil
}

// JoinStorageSession asks KVS to join the channel as the recording peer. The
// master must already be connected to signaling; KVS then sends it an SDP
// offer and archives the negotiated media into the configured stream.
func (c *AWSClient) JoinStorageSession(ctx context.Context, channelARN string) error {
	endpointOut, err := c.video.GetSignalingChannelEndpoint(ctx, &kinesisvideo.GetSignalingChannelEndpointInput{
		ChannelARN: aws.String(channelARN),
		SingleMasterChannelEndpointConfiguration: &kvtypes.SingleMasterChannelEndpointConfiguration{
			Protocols: []kvtypes.ChannelProtocol{kvtypes.ChannelProtocolWebrtc},
			Role:      kvtypes.ChannelRoleMaster,
		},
	})
	if err != nil {
		return fmt.Errorf("get WEBRTC channel endpoint: %w", err)
	}

	var endpoint string
	for _, item := range endpointOut.ResourceEndpointList {
		if item.Protocol == kvtypes.ChannelProtocolWebrtc && item.ResourceEndpoint != nil {
			endpoint = *item.ResourceEndpoint
		}
	}
	if endpoint == "" {
		return fmt.Errorf("KVS did not return a WEBRTC endpoint")
	}

	storage := kinesisvideowebrtcstorage.NewFromConfig(c.cfg, func(o *kinesisvideowebrtcstorage.Options) {
		o.BaseEndpoint = aws.String(endpoint)
	})
	if _, err := storage.JoinStorageSession(ctx, &kinesisvideowebrtcstorage.JoinStorageSessionInput{
		ChannelArn: aws.String(channelARN),
	}); err != nil {
		return fmt.Errorf("join storage session: %w", err)
	}
	return nil
}

func (c *AWSClient) HLSPlaybackURL(ctx context.Context, input HLSPlaybackInput) (string, error) {
	endpointOut, err := c.video.GetDataEndpoint(ctx, &kinesisvideo.GetDataEndpointInput{
		APIName:   kvtypes.APINameGetHlsStreamingSessionUrl,
		StreamARN: aws.String(input.StreamARN),
	})
	if err != nil {
		return "", fmt.Errorf("get data endpoint: %w", err)
	}
	if endpointOut.DataEndpoint == nil {
		return "", fmt.Errorf("get data endpoint returned no endpoint")
	}

	archived := kinesisvideoarchivedmedia.NewFromConfig(c.cfg, func(o *kinesisvideoarchivedmedia.Options) {
		o.BaseEndpoint = endpointOut.DataEndpoint
	})

	request := &kinesisvideoarchivedmedia.GetHLSStreamingSessionURLInput{
		StreamARN:       aws.String(input.StreamARN),
		ContainerFormat: hlstypes.ContainerFormatFragmentedMp4,
		// ALWAYS adds EXT-X-PROGRAM-DATE-TIME tags so players can map media
		// positions back to wall-clock time.
		DisplayFragmentTimestamp: hlstypes.HLSDisplayFragmentTimestampAlways,
		Expires:                  aws.Int32(43200),
	}
	if input.Live {
		request.PlaybackMode = hlstypes.HLSPlaybackModeLive
	} else {
		request.PlaybackMode = hlstypes.HLSPlaybackModeOnDemand
		request.MaxMediaPlaylistFragmentResults = aws.Int64(5000)
		request.HLSFragmentSelector = &hlstypes.HLSFragmentSelector{
			FragmentSelectorType: hlstypes.HLSFragmentSelectorTypeServerTimestamp,
			TimestampRange: &hlstypes.HLSTimestampRange{
				StartTimestamp: aws.Time(input.Start),
				EndTimestamp:   aws.Time(input.End),
			},
		}
	}

	out, err := archived.GetHLSStreamingSessionURL(ctx, request)
	if err != nil {
		return "", fmt.Errorf("get HLS streaming session URL: %w", err)
	}
	if out.HLSStreamingSessionURL == nil {
		return "", fmt.Errorf("HLS streaming session URL missing in response")
	}
	return *out.HLSStreamingSessionURL, nil
}

func (c *AWSClient) SignalingURL(ctx context.Context, input SignalingURLInput) (string, error) {
	creds, err := c.cfg.Credentials.Retrieve(ctx)
	if err != nil {
		return "", fmt.Errorf("retrieve AWS credentials: %w", err)
	}
	return signKVSWebSocketURL(input.Endpoint, c.region, creds, input.QueryParams)
}

func endpointSetFromKVS(items []kvtypes.ResourceEndpointListItem) (EndpointSet, error) {
	var endpoints EndpointSet
	for _, item := range items {
		if item.ResourceEndpoint == nil {
			continue
		}
		switch item.Protocol {
		case kvtypes.ChannelProtocolWss:
			endpoints.WSS = *item.ResourceEndpoint
		case kvtypes.ChannelProtocolHttps:
			endpoints.HTTPS = *item.ResourceEndpoint
		}
	}
	if endpoints.WSS == "" || endpoints.HTTPS == "" {
		return EndpointSet{}, fmt.Errorf("KVS did not return both WSS and HTTPS endpoints")
	}
	return endpoints, nil
}

func iceServersFromKVS(region string, items []sigtypes.IceServer) []ICEServer {
	servers := []ICEServer{{
		URLs: []string{fmt.Sprintf("stun:stun.kinesisvideo.%s.amazonaws.com:443", region)},
	}}

	for _, item := range items {
		server := ICEServer{
			URLs: item.Uris,
		}
		if item.Username != nil {
			server.Username = *item.Username
		}
		if item.Password != nil {
			server.Credential = *item.Password
		}
		if item.Ttl != nil {
			server.TTL = *item.Ttl
		}
		if len(server.URLs) > 0 {
			servers = append(servers, server)
		}
	}

	return servers
}

func (r Role) awsChannelRole() (kvtypes.ChannelRole, error) {
	switch r {
	case RoleMaster:
		return kvtypes.ChannelRoleMaster, nil
	case RoleViewer:
		return kvtypes.ChannelRoleViewer, nil
	default:
		return "", fmt.Errorf("unsupported role %q", r)
	}
}

func ParseRole(value string) (Role, error) {
	switch Role(value) {
	case RoleMaster:
		return RoleMaster, nil
	case RoleViewer:
		return RoleViewer, nil
	default:
		return "", fmt.Errorf("unsupported role %q", value)
	}
}

func isKVSNotFound(err error) bool {
	var notFound *kvtypes.ResourceNotFoundException
	return errors.As(err, &notFound)
}
