using System.Collections.Generic;
using System.Collections.ObjectModel;
using System.ComponentModel;
using System.IO;
using System.Net.WebSockets;
using System.Text;
using System.Windows;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Threading;
using Microsoft.Web.WebView2.Core;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using TwitchLib.Client;
using TwitchLib.Client.Models;

namespace StreamerDashboard;

public partial class MainWindow : Window, INotifyPropertyChanged
{
    private const string TwitchChannelName = "YOUR_CHANNEL_NAME";
    private const string TwitchUserName = "YOUR_BOT_USERNAME";
    private const string TwitchOAuthToken = "oauth:YOUR_OAUTH_TOKEN";
    private const string StreamerBotWebSocketUrl = "ws://127.0.0.1:8080/";

    private readonly TwitchClient _twitchClient;
    private readonly Dictionary<string, Brush> _userColors = new();
    private readonly Random _random = new();
    private readonly DispatcherTimer _webSocketReconnectTimer;
    private ClientWebSocket? _webSocket;
    private CancellationTokenSource? _webSocketCts;
    private bool _isConnecting;

    public ObservableCollection<ChatMessage> ChatMessages { get; } = new();
    public ObservableCollection<EventItem> EventItems { get; } = new();

    private HypeTrainStatus? _activeHypeTrain;
    public HypeTrainStatus? ActiveHypeTrain
    {
        get => _activeHypeTrain;
        set
        {
            if (_activeHypeTrain == value)
            {
                return;
            }

            _activeHypeTrain = value;
            OnPropertyChanged(nameof(ActiveHypeTrain));
        }
    }

    public MainWindow()
    {
        InitializeComponent();
        DataContext = this;

        _twitchClient = new TwitchClient();

        InitializeWebViewAsync();
        InitializeTwitchClient();

        _webSocketReconnectTimer = new DispatcherTimer
        {
            Interval = TimeSpan.FromSeconds(5)
        };
        _webSocketReconnectTimer.Tick += async (_, _) => await EnsureWebSocketConnectionAsync();
        _webSocketReconnectTimer.Start();
    }

    public event PropertyChangedEventHandler? PropertyChanged;

    private async void InitializeWebViewAsync()
    {
        try
        {
            await StreamView.EnsureCoreWebView2Async();
            StreamView.CoreWebView2.Settings.IsStatusBarEnabled = false;
            StreamView.Source = new Uri($"https://player.twitch.tv/?channel={TwitchChannelName}&parent=localhost&muted=false");
        }
        catch (Exception ex)
        {
            AddEventItem("WebView2 Error", ex.Message, Brushes.IndianRed);
        }
    }

    private void InitializeTwitchClient()
    {
        try
        {
            var credentials = new ConnectionCredentials(TwitchUserName, TwitchOAuthToken);
            _twitchClient.Initialize(credentials, TwitchChannelName);
            _twitchClient.OnMessageReceived += OnChatMessageReceived;
            _twitchClient.OnDisconnected += (_, _) => AddEventItem("Chat", "Disconnected from Twitch.", Brushes.IndianRed);
            _twitchClient.OnConnected += (_, _) => AddEventItem("Chat", "Connected to Twitch.", Brushes.MediumSeaGreen);
            _twitchClient.Connect();
        }
        catch (Exception ex)
        {
            AddEventItem("Chat Error", ex.Message, Brushes.IndianRed);
        }
    }

    private void OnChatMessageReceived(object? sender, TwitchLib.Client.Events.OnMessageReceivedArgs e)
    {
        var message = new ChatMessage
        {
            Timestamp = DateTime.Now.ToString("HH:mm"),
            Username = e.ChatMessage.Username,
            Message = e.ChatMessage.Message,
            UsernameBrush = ResolveUserBrush(e.ChatMessage.ColorHex, e.ChatMessage.Username)
        };

        Application.Current.Dispatcher.Invoke(() =>
        {
            ChatMessages.Add(message);
            if (ChatMessages.Count > 0)
            {
                ChatListBox.ScrollIntoView(ChatMessages[^1]);
            }
        });
    }

    private Brush ResolveUserBrush(string? colorHex, string username)
    {
        if (!string.IsNullOrWhiteSpace(colorHex))
        {
            try
            {
                var color = (Color)ColorConverter.ConvertFromString(colorHex);
                return new SolidColorBrush(color);
            }
            catch
            {
                // Fallback to random color.
            }
        }

        if (_userColors.TryGetValue(username, out var storedBrush))
        {
            return storedBrush;
        }

        var randomColor = Color.FromRgb(
            (byte)_random.Next(80, 240),
            (byte)_random.Next(80, 240),
            (byte)_random.Next(80, 240));
        var brush = new SolidColorBrush(randomColor);
        _userColors[username] = brush;
        return brush;
    }

    private async Task EnsureWebSocketConnectionAsync()
    {
        if (_isConnecting || _webSocket?.State == WebSocketState.Open)
        {
            return;
        }

        _isConnecting = true;

        try
        {
            _webSocketCts?.Cancel();
            _webSocket?.Dispose();

            _webSocketCts = new CancellationTokenSource();
            _webSocket = new ClientWebSocket();
            await _webSocket.ConnectAsync(new Uri(StreamerBotWebSocketUrl), _webSocketCts.Token);

            await SendStreamerBotSubscriptionAsync(_webSocket, _webSocketCts.Token);
            _ = Task.Run(() => ReceiveWebSocketLoopAsync(_webSocket, _webSocketCts.Token));

            AddEventItem("Streamer.bot", "WebSocket connected.", Brushes.MediumSeaGreen);
        }
        catch (Exception ex)
        {
            AddEventItem("Streamer.bot", $"WebSocket error: {ex.Message}", Brushes.IndianRed);
        }
        finally
        {
            _isConnecting = false;
        }
    }

    private static async Task SendStreamerBotSubscriptionAsync(ClientWebSocket socket, CancellationToken token)
    {
        var payload = new
        {
            request = "Subscribe",
            events = new
            {
                Twitch = new[]
                {
                    "Follow",
                    "Cheer",
                    "Sub",
                    "Resub",
                    "GiftSub",
                    "HypeTrainStart",
                    "HypeTrainUpdate",
                    "HypeTrainEnd"
                }
            },
            id = "DashboardApp"
        };

        var json = JsonConvert.SerializeObject(payload);
        var buffer = Encoding.UTF8.GetBytes(json);
        await socket.SendAsync(buffer, WebSocketMessageType.Text, true, token);
    }

    private async Task ReceiveWebSocketLoopAsync(ClientWebSocket socket, CancellationToken token)
    {
        var buffer = new byte[8192];
        try
        {
            while (socket.State == WebSocketState.Open && !token.IsCancellationRequested)
            {
                using var messageStream = new MemoryStream();
                WebSocketReceiveResult result;
                do
                {
                    result = await socket.ReceiveAsync(buffer, token);
                    if (result.MessageType == WebSocketMessageType.Close)
                    {
                        await socket.CloseAsync(WebSocketCloseStatus.NormalClosure, "Closing", token);
                        return;
                    }

                    messageStream.Write(buffer, 0, result.Count);
                }
                while (!result.EndOfMessage);

                var json = Encoding.UTF8.GetString(messageStream.ToArray());
                HandleStreamerBotMessage(json);
            }
        }
        catch (Exception ex)
        {
            AddEventItem("Streamer.bot", $"Receive error: {ex.Message}", Brushes.IndianRed);
        }
    }

    private void HandleStreamerBotMessage(string json)
    {
        try
        {
            var root = JObject.Parse(json);
            var eventName = root.SelectToken("event")?.ToString()
                ?? root.SelectToken("data.event")?.ToString()
                ?? root.SelectToken("event.type")?.ToString()
                ?? root.SelectToken("type")?.ToString();

            if (string.IsNullOrWhiteSpace(eventName))
            {
                return;
            }

            var data = root.SelectToken("data") ?? root.SelectToken("eventData") ?? root;

            switch (eventName)
            {
                case "HypeTrainStart":
                case "HypeTrainUpdate":
                    UpdateHypeTrain(data, eventName);
                    break;
                case "HypeTrainEnd":
                    Application.Current.Dispatcher.Invoke(() => ActiveHypeTrain = null);
                    AddEventItem("Hype Train", "Hype Train ended.", Brushes.HotPink);
                    break;
                default:
                    AddEventItem("Twitch Event", FormatEventSummary(eventName, data), Brushes.MediumPurple);
                    break;
            }
        }
        catch (JsonException ex)
        {
            AddEventItem("Streamer.bot", $"Invalid payload: {ex.Message}", Brushes.IndianRed);
        }
    }

    private void UpdateHypeTrain(JToken? data, string eventName)
    {
        if (data == null)
        {
            return;
        }

        var level = data.SelectToken("level")?.ToString() ?? "Unknown";
        var percent = data.SelectToken("progress")?.ToObject<double?>() ?? data.SelectToken("progressPercent")?.ToObject<double?>() ?? 0;
        if (percent > 1 && percent <= 100)
        {
            percent = Math.Clamp(percent, 0, 100);
        }
        else if (percent <= 1)
        {
            percent = Math.Clamp(percent * 100, 0, 100);
        }

        var contributors = BuildContributorsText(data.SelectToken("contributors"));
        var newStatus = new HypeTrainStatus
        {
            Level = $"Level {level}",
            Percent = percent,
            PercentText = $"{percent:0}% complete",
            Contributors = contributors
        };

        Application.Current.Dispatcher.Invoke(() => ActiveHypeTrain = newStatus);
    }

    private static string BuildContributorsText(JToken? contributorsToken)
    {
        if (contributorsToken is not JArray contributorsArray)
        {
            return "Contributors: N/A";
        }

        var entries = new List<string>();
        foreach (var contributor in contributorsArray)
        {
            var name = contributor.SelectToken("displayName")?.ToString()
                ?? contributor.SelectToken("name")?.ToString()
                ?? "Viewer";
            var total = contributor.SelectToken("total")?.ToString() ?? contributor.SelectToken("amount")?.ToString();
            entries.Add(string.IsNullOrWhiteSpace(total) ? name : $"{name} ({total})");
        }

        return entries.Count == 0
            ? "Contributors: N/A"
            : $"Contributors: {string.Join(", ", entries)}";
    }

    private static string FormatEventSummary(string eventName, JToken? data)
    {
        if (data == null)
        {
            return eventName;
        }

        var user = data.SelectToken("user")?.ToString()
            ?? data.SelectToken("userName")?.ToString()
            ?? data.SelectToken("displayName")?.ToString()
            ?? "Viewer";
        var message = data.SelectToken("message")?.ToString();
        var bits = data.SelectToken("bits")?.ToString();
        var tier = data.SelectToken("tier")?.ToString();

        var details = new List<string> { user };
        if (!string.IsNullOrWhiteSpace(message))
        {
            details.Add(message);
        }
        if (!string.IsNullOrWhiteSpace(bits))
        {
            details.Add($"Bits: {bits}");
        }
        if (!string.IsNullOrWhiteSpace(tier))
        {
            details.Add($"Tier: {tier}");
        }

        return string.Join(" • ", details);
    }

    private void AddEventItem(string title, string description, Brush accent)
    {
        var item = new EventItem
        {
            Title = title,
            Description = description,
            Timestamp = DateTime.Now.ToString("HH:mm:ss"),
            AccentBrush = accent
        };

        Application.Current.Dispatcher.Invoke(() => EventItems.Insert(0, item));
    }

    private void OnDragWindow(object sender, MouseButtonEventArgs e)
    {
        if (e.ChangedButton == MouseButton.Left)
        {
            DragMove();
        }
    }

    private void OnClose(object sender, RoutedEventArgs e)
    {
        Close();
    }

    protected override void OnClosed(EventArgs e)
    {
        _webSocketCts?.Cancel();
        _webSocket?.Dispose();
        if (_twitchClient.IsConnected)
        {
            _twitchClient.Disconnect();
        }

        base.OnClosed(e);
    }

    private void OnPropertyChanged(string propertyName)
    {
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(propertyName));
    }
}

public class ChatMessage
{
    public string Timestamp { get; init; } = string.Empty;
    public string Username { get; init; } = string.Empty;
    public string Message { get; init; } = string.Empty;
    public Brush UsernameBrush { get; init; } = Brushes.White;
}

public class EventItem
{
    public string Title { get; init; } = string.Empty;
    public string Description { get; init; } = string.Empty;
    public string Timestamp { get; init; } = string.Empty;
    public Brush AccentBrush { get; init; } = Brushes.MediumPurple;
}

public class HypeTrainStatus
{
    public string Level { get; init; } = string.Empty;
    public double Percent { get; init; }
    public string PercentText { get; init; } = string.Empty;
    public string Contributors { get; init; } = string.Empty;
}
