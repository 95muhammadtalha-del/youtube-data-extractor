import logging
import re
from typing import Dict, List, Any
import isodate
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError

logger = logging.getLogger(__name__)

def format_duration(seconds: int) -> str:
    """Converts seconds to human-readable string (e.g., 45 -> '0:45', 754 -> '12:34')."""
    hours = seconds // 3600
    minutes = (seconds % 3600) // 60
    secs = seconds % 60
    
    if hours > 0:
        return f"{hours}:{minutes:02d}:{secs:02d}"
    else:
        return f"{minutes}:{secs:02d}"

class YouTubeService:
    def __init__(self, api_key: str):
        if not api_key:
            raise ValueError("YouTube API Key is required")
        self.youtube = build('youtube', 'v3', developerKey=api_key)
        
    def resolve_channel_id(self, query: str) -> str:
        """Resolves a URL, handle, or ID to a channel ID."""
        logger.info(f"Resolving channel ID for query: {query}")
        query = query.strip()
        
        # If it's already an ID
        if query.startswith('UC') and len(query) == 24:
            return query
            
        # Extract handle or ID from URL
        if 'youtube.com' in query or 'youtu.be' in query:
            match = re.search(r'(?:youtube\.com\/(?:@|c\/|user\/|channel\/)|youtu\.be\/)([^/?&]+)', query)
            if match:
                extracted = match.group(1)
                # If the extracted part is a channel ID
                if extracted.startswith('UC') and len(extracted) == 24 and 'channel/' in query:
                    return extracted
                query = '@' + extracted if not extracted.startswith('@') else extracted

        # If it's a handle
        if query.startswith('@'):
            try:
                # Try getting channel by forHandle (if supported in v3 - actually it's list(forHandle=...) recently added or search)
                # For safety, let's use search since forHandle is sometimes restricted or undocumented in older client versions,
                # but let's try search.list with type=channel and q=query
                search_response = self.youtube.search().list(
                    part='snippet',
                    q=query,
                    type='channel',
                    maxResults=1
                ).execute()
                
                if search_response.get('items'):
                    return search_response['items'][0]['snippet']['channelId']
                else:
                    raise ValueError(f"Channel not found for handle: {query}")
            except HttpError as e:
                logger.error(f"Error resolving handle: {e}")
                raise ValueError(f"Failed to resolve channel handle: {e}")

        # Last resort: just search for the query and pick the first channel
        try:
            search_response = self.youtube.search().list(
                part='snippet',
                q=query,
                type='channel',
                maxResults=1
            ).execute()
            
            if search_response.get('items'):
                return search_response['items'][0]['snippet']['channelId']
        except HttpError as e:
            pass

        raise ValueError(f"Could not resolve channel ID for: {query}")

    def get_channel_info(self, channel_id: str) -> Dict[str, Any]:
        """Fetches channel snippet, statistics, brandingSettings."""
        logger.info(f"Fetching info for channel ID: {channel_id}")
        try:
            response = self.youtube.channels().list(
                part='snippet,statistics,brandingSettings',
                id=channel_id
            ).execute()
            
            if not response.get('items'):
                raise ValueError(f"Channel {channel_id} not found")
                
            item = response['items'][0]
            snippet = item['snippet']
            stats = item['statistics']
            branding = item.get('brandingSettings', {})
            
            return {
                'id': item['id'],
                'name': snippet.get('title', ''),
                'handle': snippet.get('customUrl', ''),
                'description': snippet.get('description', ''),
                'subscriber_count': int(stats.get('subscriberCount', 0)),
                'view_count': int(stats.get('viewCount', 0)),
                'video_count': int(stats.get('videoCount', 0)),
                'published_at': snippet.get('publishedAt', ''),
                'thumbnail_url': snippet.get('thumbnails', {}).get('high', {}).get('url', ''),
                'country': snippet.get('country', branding.get('channel', {}).get('country', '')),
                'banner_url': branding.get('image', {}).get('bannerExternalUrl', '')
            }
        except HttpError as e:
            logger.error(f"Error fetching channel info: {e}")
            raise

    def get_all_videos(self, channel_id: str) -> List[Dict[str, Any]]:
        """Gets all videos from the channel's uploads playlist."""
        logger.info(f"Fetching all videos for channel ID: {channel_id}")
        uploads_playlist_id = 'UU' + channel_id[2:]
        videos = []
        next_page_token = None
        
        try:
            while True:
                response = self.youtube.playlistItems().list(
                    part='snippet',
                    playlistId=uploads_playlist_id,
                    maxResults=50,
                    pageToken=next_page_token
                ).execute()
                
                for item in response.get('items', []):
                    snippet = item['snippet']
                    videos.append({
                        'video_id': snippet['resourceId']['videoId'],
                        'title': snippet['title'],
                        'published_at': snippet['publishedAt'],
                        'thumbnail_url': snippet.get('thumbnails', {}).get('high', {}).get('url', '')
                    })
                    
                next_page_token = response.get('nextPageToken')
                if not next_page_token:
                    break
                    
            return videos
        except HttpError as e:
            logger.error(f"Error fetching playlist items: {e}")
            raise

    def get_video_details(self, video_ids: List[str]) -> List[Dict[str, Any]]:
        """Gets detailed statistics and duration for a list of video IDs (batch of 50 max)."""
        if not video_ids:
            return []
            
        logger.info(f"Fetching details for {len(video_ids)} videos")
        detailed_videos = []
        
        # Break into batches of 50
        for i in range(0, len(video_ids), 50):
            batch_ids = video_ids[i:i+50]
            try:
                response = self.youtube.videos().list(
                    part='snippet,contentDetails,statistics',
                    id=','.join(batch_ids)
                ).execute()
                
                for item in response.get('items', []):
                    snippet = item['snippet']
                    content_details = item['contentDetails']
                    stats = item['statistics']
                    
                    duration_iso = content_details.get('duration', 'PT0S')
                    duration_td = isodate.parse_duration(duration_iso)
                    duration_seconds = int(duration_td.total_seconds())
                    
                    detailed_videos.append({
                        'video_id': item['id'],
                        'title': snippet.get('title', ''),
                        'duration_iso': duration_iso,
                        'duration_seconds': duration_seconds,
                        'duration_formatted': format_duration(duration_seconds),
                        'published_at': snippet.get('publishedAt', ''),
                        'description': snippet.get('description', ''),
                        'view_count': int(stats.get('viewCount', 0)),
                        'like_count': int(stats.get('likeCount', 0)),
                        'comment_count': int(stats.get('commentCount', 0)),
                        'thumbnail_url': snippet.get('thumbnails', {}).get('high', {}).get('url', '')
                    })
            except HttpError as e:
                logger.error(f"Error fetching video details: {e}")
                raise
                
        return detailed_videos

    def extract_channel_data(self, query: str) -> Dict[str, Any]:
        """Main orchestrator to extract all channel data."""
        channel_id = self.resolve_channel_id(query)
        channel_info = self.get_channel_info(channel_id)
        
        basic_videos = self.get_all_videos(channel_id)
        video_ids = [v['video_id'] for v in basic_videos]
        
        detailed_videos = self.get_video_details(video_ids)
        
        shorts = []
        long_videos = []
        
        for video in detailed_videos:
            if video['duration_seconds'] <= 60:
                shorts.append(video)
            else:
                long_videos.append(video)
                
        # Sort by published date descending
        shorts.sort(key=lambda x: x['published_at'], reverse=True)
        long_videos.sort(key=lambda x: x['published_at'], reverse=True)
                
        return {
            'channel': channel_info,
            'shorts': shorts,
            'long_videos': long_videos,
            'summary': {
                'total_videos': len(detailed_videos),
                'total_shorts': len(shorts),
                'total_longs': len(long_videos)
            }
        }
