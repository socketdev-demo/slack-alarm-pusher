# Socket Alarm Pusher

A Node.js application that monitors your dependencies for security vulnerabilities and sends alerts to Slack when new issues are detected.

## What it does

This tool continuously polls your project's dependencies using the [Socket API](https://socket.dev) and sends real-time notifications to Slack when:

- New security vulnerabilities are discovered
- Malware is detected in your dependencies
- Other security issues are found

The tool is designed to run continuously and will only send notifications for new alerts (it remembers previously seen alerts to avoid spam).


## Prerequisites

- Node.js (v16 or higher)
- A Socket API key (get one at [socket.dev](https://socket.dev))
- A Slack webhook URL (optional, for notifications)

## Installation

1. Clone this repository:
   ```bash
   git clone <repository-url>
   cd socket-alarm-pusher
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Copy the environment file and configure it:
   ```bash
   cp .env.example .env
   ```

4. Edit the `.env` file with your configuration (see Configuration section below)

## Configuration

Create a `.env` file in the project root with the following variables:

```env
# Socket API Key - Get from https://socket.dev
SOCKET_KEY=your_socket_api_key_here

# Slack Webhook URL for notifications
SLACK_WEBHOOK=your_slack_webhook_url_here

# Poll interval in milliseconds (default: 600000 = 10 minutes)
POLL_INTERVAL_MS=600000

# Severity filter: low, medium, high (default: high)
SEVERITY_FILTER=high

# Repository filter: comma-separated list of repo names (optional, null = all repos)
# Example: REPO_FILTER=my-repo,another-repo
REPO_FILTER=

# Category filter: comma-separated list of alert categories (optional, null = all categories)
# Example: CATEGORY_FILTER=vulnerability,malware
CATEGORY_FILTER=
```

### Environment Variables Explained

- **SOCKET_KEY** (required): Your Socket API key from [socket.dev](https://socket.dev)
- **SLACK_WEBHOOK** (optional): Slack webhook URL for sending notifications. If not provided, alerts will only be logged to console
- **POLL_INTERVAL_MS** (optional): How often to check for new alerts in milliseconds. Default is 10 minutes (600,000ms)
- **SEVERITY_FILTER** (optional): Only send alerts for this severity level. Options: `low`, `medium`, `high`. Default is `high`
- **REPO_FILTER** (optional): Only monitor specific repositories. Provide as comma-separated list. Leave empty to monitor all repos
- **CATEGORY_FILTER** (optional): Only send alerts for specific categories. Provide as comma-separated list. Leave empty for all categories

## Usage

### Running the application

```bash
node socket-poll.js
```

The application will:
1. Fetch all your dependencies from Socket
2. Check each dependency for security alerts
3. Send notifications to Slack for new alerts matching your filters
4. Wait for the specified interval and repeat