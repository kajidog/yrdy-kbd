package main

import (
	"context"
	"errors"
	"fmt"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/kinesisvideo"
	kvtypes "github.com/aws/aws-sdk-go-v2/service/kinesisvideo/types"
	"github.com/aws/aws-sdk-go-v2/service/kinesisvideosignaling"
	sigtypes "github.com/aws/aws-sdk-go-v2/service/kinesisvideosignaling/types"
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

type KVSClient interface {
	EnsureSignalingChannel(ctx context.Context, channelName string) (string, error)
	SessionConfig(ctx context.Context, input SessionInput) (SessionConfig, error)
	SignalingURL(ctx context.Context, input SignalingURLInput) (string, error)
}

type AWSKVSClient struct {
	region string
	cfg    aws.Config
	video  *kinesisvideo.Client
}

func NewAWSKVSClient(ctx context.Context, region string) (*AWSKVSClient, error) {
	cfg, err := config.LoadDefaultConfig(ctx, config.WithRegion(region))
	if err != nil {
		return nil, fmt.Errorf("load AWS config: %w", err)
	}
	return &AWSKVSClient{
		region: region,
		cfg:    cfg,
		video:  kinesisvideo.NewFromConfig(cfg),
	}, nil
}

func (c *AWSKVSClient) EnsureSignalingChannel(ctx context.Context, channelName string) (string, error) {
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

func (c *AWSKVSClient) SessionConfig(ctx context.Context, input SessionInput) (SessionConfig, error) {
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

func (c *AWSKVSClient) SignalingURL(ctx context.Context, input SignalingURLInput) (string, error) {
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

func parseRole(value string) (Role, error) {
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
