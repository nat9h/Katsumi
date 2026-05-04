/**
 * Spotify Search
 * Credits to andhikagg:
 * https://z.ndid.eu.org/snippet/fb72c440523fee9e2b457c323deb7cae
 *
 * This version includes several improvements and refactors.
 */
import axios from "axios";
import { Buffer } from "node:buffer";
import { createHmac, randomUUID } from "node:crypto";

const supported_types = new Set(["track", "artist", "album", "playlist"]);

const config = Object.freeze({
	secret: "376136387538459893883312310911992847112448894410210511297108",
	totpVersion: 61,
	clientVersion: "1.2.88.61.ge172202b",
	queries: {
		search: {
			operationName: "searchDesktop",
			sha256Hash:
				"21b3fe49546912ba782db5c47e9ef5a7dbd20329520ba0c7d0fcfadee671d24e",
		},
		track: {
			operationName: "getTrack",
			sha256Hash:
				"612585ae06ba435ad26369870deaae23b5c8800a256cd8a57e08eddc25a37294",
		},
		artist: {
			operationName: "queryArtistOverview",
			sha256Hash:
				"5b9e64f43843fa3a9b6a98543600299b0a2cbbbccfdcdcef2402eb9c1017ca4c",
		},
		album: {
			operationName: "getAlbum",
			sha256Hash:
				"b9bfabef66ed756e5e13f68a942deb60bd4125ec1f1be8cc42769dc0259b4b10",
		},
		playlist: {
			operationName: "fetchPlaylist",
			sha256Hash:
				"32b05e92e438438408674f95d0fdad8082865dc32acd55bd97f5113b8579092b",
		},
	},
});

const headers = Object.freeze({
	referer: "https://open.spotify.com/",
	origin: "https://open.spotify.com",
	"content-type": "application/json",
	accept: "application/json",
	"user-agent":
		"Mozilla/5.0 (Linux; Android 16; NX729J) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.7499.34 Mobile Safari/537.36",
});

const asArray = (value) => (Array.isArray(value) ? value : []);

const toInt = (value, fallback = 0) => {
	const parsed = Number.parseInt(value, 10);
	return Number.isFinite(parsed) ? parsed : fallback;
};

class Parser {
	#getImages(image) {
		return asArray(image?.sources).map((source) => ({
			url: source.url ?? null,
			width: source.width ?? source.maxWidth ?? null,
			height: source.height ?? source.maxHeight ?? null,
		}));
	}

	#getColor(image) {
		return (
			image?.extractedColors?.colorRaw?.hex ??
			image?.extractedColors?.colorDark?.hex ??
			null
		);
	}

	#getVisualIdentity(visualIdentity) {
		const colorSet =
			visualIdentity?.squareCoverImage?.extractedColorSet ??
			visualIdentity?.extractedColorSet;

		if (!colorSet) {
			return null;
		}

		return {
			text_color: colorSet.encoreBaseSetTextColor ?? null,
			high_contrast: colorSet.highContrast ?? null,
			higher_contrast: colorSet.higherContrast ?? null,
			min_contrast: colorSet.minContrast ?? null,
		};
	}

	#getLink(uri) {
		if (!uri || typeof uri !== "string") {
			return {
				uri: uri ?? null,
				id: null,
				url: null,
			};
		}

		const [scheme, type, id] = uri.split(":");

		if (scheme !== "spotify" || !type || !id) {
			return {
				uri,
				id: null,
				url: null,
			};
		}

		return {
			uri,
			id,
			url: `https://open.spotify.com/${type}/${id}`,
		};
	}

	#getPlayability(data) {
		return {
			playable:
				data?.playability?.playable === true ||
				data?.playability?.reason === "PLAYABLE",
			reason: data?.playability?.reason ?? null,
		};
	}

	#parseItems(items, mapper, { wrapped = false } = {}) {
		return asArray(items).reduce((acc, node) => {
			const data = wrapped ? node.item?.data : node.data;
			if (!data) {
				return acc;
			}

			acc.push({
				...mapper(data),
				...(node.matchedFields
					? { matched_fields: node.matchedFields }
					: {}),
			});

			return acc;
		}, []);
	}

	#parseArtists(items) {
		return asArray(items).map((artist) => ({
			...this.#getLink(artist.uri),
			name: artist.profile?.name ?? null,
		}));
	}

	parseSearch(res) {
		if (!res) {
			return null;
		}

		const trackItems = res.tracksV2?.items?.length
			? res.tracksV2.items
			: asArray(res.topResultsV2?.itemsV2).filter(
					(item) => item.item?.__typename === "TrackResponseWrapper"
				);

		return {
			top_results: asArray(res.topResultsV2?.itemsV2).reduce(
				(acc, node) => {
					const wrapper = node.item;
					const data = wrapper?.data;
					if (!data) {
						return acc;
					}

					const type =
						wrapper.__typename?.replace("ResponseWrapper", "") ??
						"Unknown";

					acc.push({
						type,
						...this.#getLink(data.uri),
						name:
							data.name ??
							data.profile?.name ??
							data.displayName ??
							null,
						images: this.#getImages(
							data.coverArt ??
								data.visuals?.avatarImage ??
								data.images?.items?.[0] ??
								data.avatar
						),
						matched_fields: node.matchedFields ?? [],
					});

					return acc;
				},
				[]
			),

			tracks: this.#parseItems(
				trackItems,
				(track) => ({
					...this.#getLink(track.uri),
					name: track.name ?? null,
					duration_ms: track.duration?.totalMilliseconds ?? 0,
					explicit: track.contentRating?.label === "EXPLICIT",
					media_type: track.trackMediaType ?? null,
					playability: this.#getPlayability(track),
					associations: {
						audio_count:
							track.associationsV3?.audioAssociations
								?.totalCount ?? 0,
						video_count:
							track.associationsV3?.videoAssociations
								?.totalCount ?? 0,
					},
					artists: this.#parseArtists(track.artists?.items),
					album: {
						...this.#getLink(track.albumOfTrack?.uri),
						name: track.albumOfTrack?.name ?? null,
						images: this.#getImages(track.albumOfTrack?.coverArt),
						color_dark: this.#getColor(
							track.albumOfTrack?.coverArt
						),
						visual_identity: this.#getVisualIdentity(
							track.albumOfTrack?.visualIdentity
						),
					},
					sixteen_by_nine_cover:
						track.visualIdentity?.sixteenByNineCoverImage?.image
							?.data?.sources ?? [],
				}),
				{ wrapped: true }
			),

			albums: this.#parseItems(res.albumsV2?.items, (album) => ({
				...this.#getLink(album.uri),
				name: album.name ?? null,
				album_type: album.type ?? null,
				release_year: album.date?.year ?? null,
				playability: this.#getPlayability(album),
				artists: this.#parseArtists(album.artists?.items),
				images: this.#getImages(album.coverArt),
				color_dark: this.#getColor(album.coverArt),
				visual_identity: this.#getVisualIdentity(album.visualIdentity),
			})),

			artists: this.#parseItems(res.artists?.items, (artist) => ({
				...this.#getLink(artist.uri),
				name: artist.profile?.name ?? null,
				images: this.#getImages(artist.visuals?.avatarImage),
				color_dark: this.#getColor(artist.visuals?.avatarImage),
				visual_identity: this.#getVisualIdentity(artist.visualIdentity),
			})),

			episodes: this.#parseItems(res.episodes?.items, (episode) => ({
				...this.#getLink(episode.uri),
				name: episode.name ?? null,
				description: episode.description ?? null,
				duration_ms: episode.duration?.totalMilliseconds ?? 0,
				explicit: episode.contentRating?.label === "EXPLICIT",
				media_types: episode.mediaTypes ?? [],
				release_date: episode.releaseDate?.isoString ?? null,
				playability: this.#getPlayability(episode),
				played_state: episode.playedState?.state ?? null,
				is_paywall: Boolean(episode.restrictions?.paywallContent),
				images: this.#getImages(episode.coverArt),
				color_dark: this.#getColor(episode.coverArt),
				visual_identity: this.#getVisualIdentity(
					episode.visualIdentity
				),
				video_preview_thumbnail: this.#getImages(
					episode.videoPreviewThumbnail?.imagePreview?.data
				),
				podcast: {
					...this.#getLink(episode.podcastV2?.data?.uri),
					name: episode.podcastV2?.data?.name ?? null,
					publisher: episode.podcastV2?.data?.publisher?.name ?? null,
					media_type: episode.podcastV2?.data?.mediaType ?? null,
				},
			})),

			podcasts: this.#parseItems(res.podcasts?.items, (podcast) => ({
				...this.#getLink(podcast.uri),
				name: podcast.name ?? null,
				publisher: podcast.publisher?.name ?? null,
				media_type: podcast.mediaType ?? null,
				topics: asArray(podcast.topics?.items).map((topic) => ({
					...this.#getLink(topic.uri),
					title: topic.title ?? null,
				})),
				images: this.#getImages(podcast.coverArt),
				color_dark: this.#getColor(podcast.coverArt),
				visual_identity: this.#getVisualIdentity(
					podcast.visualIdentity
				),
			})),

			playlists: this.#parseItems(res.playlists?.items, (playlist) => ({
				...this.#getLink(playlist.uri),
				name: playlist.name ?? null,
				description: playlist.description ?? null,
				format: playlist.format ?? null,
				attributes: playlist.attributes ?? [],
				images: this.#getImages(playlist.images?.items?.[0]),
				color_dark: this.#getColor(playlist.images?.items?.[0]),
				visual_identity: this.#getVisualIdentity(
					playlist.visualIdentity
				),
				owner: {
					...this.#getLink(playlist.ownerV2?.data?.uri),
					display_name: playlist.ownerV2?.data?.name ?? null,
					username: playlist.ownerV2?.data?.username ?? null,
					images: this.#getImages(playlist.ownerV2?.data?.avatar),
				},
			})),

			genres: this.#parseItems(res.genres?.items, (genre) => ({
				...this.#getLink(genre.uri),
				name: genre.name ?? null,
				images: this.#getImages(genre.image),
				color_dark: this.#getColor(genre.image),
			})),

			users: this.#parseItems(res.users?.items, (user) => ({
				...this.#getLink(user.uri),
				display_name: user.displayName ?? null,
				username: user.username ?? null,
				images: this.#getImages(user.avatar),
				color_dark: this.#getColor(user.avatar),
			})),
		};
	}

	parseTrack(data) {
		const track = data?.track ?? data;
		if (!track || track.__typename !== "Track") {
			return null;
		}

		const allArtists = [
			...asArray(track.firstArtist?.items),
			...asArray(track.otherArtists?.items),
		];

		return {
			...this.#getLink(track.uri),
			name: track.name ?? null,
			duration_ms: track.duration?.totalMilliseconds ?? 0,
			playcount: toInt(track.playcount),
			explicit: track.contentRating?.label === "EXPLICIT",
			track_number: track.trackNumber ?? null,
			album: {
				...this.#getLink(track.albumOfTrack?.uri),
				name: track.albumOfTrack?.name ?? null,
				album_type: track.albumOfTrack?.type ?? null,
				release_year: track.albumOfTrack?.date?.year ?? null,
				images: this.#getImages(track.albumOfTrack?.coverArt),
				color: this.#getColor(track.albumOfTrack?.coverArt),
				visual_identity: this.#getVisualIdentity(
					track.albumOfTrack?.visualIdentity
				),
			},
			artists: allArtists.map((node) => ({
				...this.#getLink(node.uri),
				name: node.profile?.name ?? null,
				images: this.#getImages(node.visuals?.avatarImage),
			})),
		};
	}

	parseArtist(data) {
		const artist = data?.artist ?? data;
		if (!artist || artist.__typename !== "Artist") {
			return null;
		}

		const uri = artist.uri ?? `spotify:artist:${artist.id}`;

		return {
			...this.#getLink(uri),
			name: artist.profile?.name ?? null,
			verified: Boolean(artist.profile?.verified),
			images: this.#getImages(artist.visuals?.avatarImage),
			header_images: this.#getImages(
				artist.visuals?.headerImage?.data ?? artist.headerImage?.data
			),
			color: this.#getColor(artist.visuals?.avatarImage),
			statistics: {
				followers: artist.stats?.followers ?? 0,
				monthly_listeners: artist.stats?.monthlyListeners ?? 0,
			},
			top_tracks: asArray(artist.discography?.topTracks?.items).map(
				(node) => {
					const track = node.track;

					return {
						...this.#getLink(track?.uri),
						name: track?.name ?? null,
						playcount: toInt(track?.playcount),
						duration_ms: track?.duration?.totalMilliseconds ?? 0,
						album: {
							...this.#getLink(track?.albumOfTrack?.uri),
							name: track?.albumOfTrack?.name ?? null,
							images: this.#getImages(
								track?.albumOfTrack?.coverArt
							),
						},
					};
				}
			),
		};
	}

	parseAlbum(data) {
		const album = data?.albumUnion ?? data?.album ?? data;

		if (!album || !["Album", "AlbumRelease"].includes(album.__typename)) {
			return null;
		}

		return {
			...this.#getLink(album.uri),
			name: album.name ?? null,
			album_type: album.type ?? null,
			release_date: album.date?.isoString ?? album.date?.year ?? null,
			label: album.label ?? null,
			playability: this.#getPlayability(album),
			images: this.#getImages(album.coverArt),
			color: this.#getColor(album.coverArt),
			visual_identity: this.#getVisualIdentity(album.visualIdentity),
			artists: this.#parseArtists(album.artists?.items),
			copyrights: album.copyrights?.items ?? [],
			tracks: asArray(album.tracks?.items ?? album.tracksV2?.items).map(
				(node) => {
					const track = node.track ?? node;

					return {
						...this.#getLink(track.uri),
						name: track.name ?? null,
						duration_ms: track.duration?.totalMilliseconds ?? 0,
						playcount: toInt(track.playcount),
						explicit: track.contentRating?.label === "EXPLICIT",
						track_number: track.trackNumber ?? null,
						artists: this.#parseArtists(track.artists?.items),
					};
				}
			),
		};
	}

	parsePlaylist(data) {
		const rawPlaylist = data?.playlistV2 ?? data?.playlist ?? data;
		const playlist = rawPlaylist?.data ?? rawPlaylist;

		if (!playlist || playlist.__typename !== "Playlist") {
			return null;
		}

		return {
			...this.#getLink(playlist.uri),
			name: playlist.name ?? null,
			description: playlist.description ?? null,
			format: playlist.format ?? null,
			followers:
				playlist.followers ?? playlist.ownerV2?.data?.followers ?? 0,
			images: this.#getImages(
				playlist.images?.items?.[0] ?? playlist.image
			),
			color: this.#getColor(
				playlist.images?.items?.[0] ?? playlist.image
			),
			visual_identity: this.#getVisualIdentity(playlist.visualIdentity),
			owner: {
				...this.#getLink(playlist.ownerV2?.data?.uri),
				display_name: playlist.ownerV2?.data?.name ?? null,
				username: playlist.ownerV2?.data?.username ?? null,
				images: this.#getImages(playlist.ownerV2?.data?.avatar),
			},
			tracks: asArray(playlist.content?.items ?? playlist.tracks?.items)
				.map((node) => {
					const track = node.item?.data ?? node.track ?? node;
					if (!track || track.__typename !== "Track") {
						return null;
					}

					return {
						...this.#getLink(track.uri),
						name: track.name ?? null,
						duration_ms: track.duration?.totalMilliseconds ?? 0,
						explicit: track.contentRating?.label === "EXPLICIT",
						album: {
							...this.#getLink(track.albumOfTrack?.uri),
							name: track.albumOfTrack?.name ?? null,
							images: this.#getImages(
								track.albumOfTrack?.coverArt
							),
						},
						artists: this.#parseArtists(track.artists?.items),
					};
				})
				.filter(Boolean),
		};
	}
}

class Spotify {
	constructor({ timeout = 30_000, cacheTTL = 5 * 60_000 } = {}) {
		this.config = config;
		this.parser = new Parser();
		this.tokenExpiresAt = 0;
		this.cacheTTL = cacheTTL;
		this.cache = new Map();

		this.http = axios.create({
			timeout,
			headers,
		});
	}

	generateTOTP(timestampMs = Date.now()) {
		const counter = Math.floor(timestampMs / 1000 / 30);
		const buffer = Buffer.alloc(8);

		buffer.writeBigInt64BE(BigInt(counter));

		const digest = createHmac(
			"sha1",
			Buffer.from(this.config.secret, "utf8")
		)
			.update(buffer)
			.digest();

		const offset = digest[digest.length - 1] & 0x0f;
		const code = (digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;

		return String(code).padStart(6, "0");
	}

	clearToken() {
		delete this.http.defaults.headers.common.authorization;
		delete this.http.defaults.headers.common["client-token"];

		this.tokenExpiresAt = 0;
	}

	clearCache() {
		this.cache.clear();
	}

	#hasValidToken() {
		return Boolean(
			this.http.defaults.headers.common.authorization &&
			this.http.defaults.headers.common["client-token"] &&
			Date.now() < this.tokenExpiresAt - 60_000
		);
	}

	#setAuthHeaders(headers) {
		Object.assign(this.http.defaults.headers.common, headers);
	}

	#getCacheKey(name, variables) {
		return `${name}:${JSON.stringify(variables)}`;
	}

	#getCache(key) {
		const cached = this.cache.get(key);
		if (!cached) {
			return null;
		}

		if (Date.now() > cached.expiresAt) {
			this.cache.delete(key);
			return null;
		}

		return cached.value;
	}

	#setCache(key, value) {
		this.cache.set(key, {
			value,
			expiresAt: Date.now() + this.cacheTTL,
		});
	}

	#assertGraphQL(data) {
		if (!Array.isArray(data?.errors) || data.errors.length === 0) {
			return;
		}

		const firstError = data.errors[0];

		throw new Error(
			firstError?.message ||
				firstError?.extensions?.code ||
				"Spotify GraphQL error."
		);
	}

	#parseSpotifyInput(input, fallbackType = null) {
		const value = String(input || "").trim();

		if (!value) {
			throw new Error("Spotify input is required.");
		}

		if (value.startsWith("spotify:")) {
			const [, type, id] = value.split(":");

			if (!supported_types.has(type) || !id) {
				throw new Error("Unsupported Spotify URI.");
			}

			return { type, id };
		}

		try {
			const url = new URL(value);
			const parts = url.pathname.split("/").filter(Boolean);
			const typeIndex = parts.findIndex((part) =>
				supported_types.has(part)
			);

			if (url.hostname.includes("spotify.com") && typeIndex !== -1) {
				const type = parts[typeIndex];
				const id = parts[typeIndex + 1];

				if (!id) {
					throw new Error("Invalid Spotify URL.");
				}

				return {
					type,
					id,
				};
			}
		} catch {
			// Not a valid URL. Treat as raw Spotify ID below.
		}

		return {
			type: fallbackType,
			id: value.split("?")[0],
		};
	}

	async getToken() {
		if (this.#hasValidToken()) {
			return true;
		}

		try {
			const now = Date.now();
			const timestampSeconds = Math.floor(now / 1000);

			const { data: token } = await this.http.get(
				"https://open.spotify.com/api/token",
				{
					params: {
						reason: "init",
						productType: "web-player",
						totp: this.generateTOTP(now),
						totpServer: this.generateTOTP(timestampSeconds * 1000),
						totpVer: String(this.config.totpVersion),
					},
				}
			);

			const { data: client } = await this.http.post(
				"https://clienttoken.spotify.com/v1/clienttoken",
				{
					client_data: {
						client_version: this.config.clientVersion,
						client_id: token.clientId,
						js_sdk_data: {
							device_brand: "unknown",
							device_model: "unknown",
							os: "linux",
							os_version: "24.04",
							device_id: randomUUID(),
							device_type: "computer",
						},
					},
				}
			);

			this.#setAuthHeaders({
				"accept-language": "en",
				"app-platform": "WebPlayer",
				authorization: `Bearer ${token.accessToken}`,
				"client-token": client.granted_token.token,
				"spotify-app-version": this.config.clientVersion,
			});

			this.tokenExpiresAt =
				Number(token.accessTokenExpirationTimestampMs) ||
				Date.now() + 55 * 60_000;

			return true;
		} catch {
			this.clearToken();
			return false;
		}
	}

	async query(name, variables, { cache = true, retry = true } = {}) {
		const selectedQuery = this.config.queries[name];

		if (!selectedQuery) {
			throw new Error(`Unknown Spotify query: ${name}`);
		}

		const cacheKey = this.#getCacheKey(name, variables);

		if (cache) {
			const cached = this.#getCache(cacheKey);
			if (cached) {
				return cached;
			}
		}

		if (!(await this.getToken())) {
			throw new Error("Failed to initialize Spotify token.");
		}

		try {
			const { data } = await this.http.post(
				"https://api-partner.spotify.com/pathfinder/v2/query",
				{
					variables,
					operationName: selectedQuery.operationName,
					extensions: {
						persistedQuery: {
							version: 1,
							sha256Hash: selectedQuery.sha256Hash,
						},
					},
				}
			);

			this.#assertGraphQL(data);

			if (cache) {
				this.#setCache(cacheKey, data);
			}

			return data;
		} catch (error) {
			const status = error.response?.status;

			if (retry && (status === 401 || status === 403)) {
				this.clearToken();

				return this.query(name, variables, {
					cache: false,
					retry: false,
				});
			}

			throw error;
		}
	}

	async searchAll(
		query,
		{
			offset = 0,
			limit = 10,
			numberOfTopResults = 5,
			includeAudiobooks = false,
			includePreReleases = true,
		} = {}
	) {
		if (!query?.trim()) {
			throw new Error("Search query is required.");
		}

		const res = await this.query("search", {
			searchTerm: query,
			offset,
			limit,
			numberOfTopResults,
			includeAudiobooks,
			includeArtistHasConcertsField: false,
			includePreReleases,
			includeAuthors: false,
			includeEpisodeContentRatingsV2: false,
		});

		return this.parser.parseSearch(res.data?.searchV2);
	}

	async search(query, options = {}) {
		return this.searchTracks(query, options);
	}

	async searchTracks(query, options = {}) {
		const result = await this.searchAll(query, options);
		return result?.tracks ?? [];
	}

	async searchAlbums(query, options = {}) {
		const result = await this.searchAll(query, options);
		return result?.albums ?? [];
	}

	async searchArtists(query, options = {}) {
		const result = await this.searchAll(query, options);
		return result?.artists ?? [];
	}

	async searchPlaylists(query, options = {}) {
		const result = await this.searchAll(query, options);
		return result?.playlists ?? [];
	}

	async searchPodcasts(query, options = {}) {
		const result = await this.searchAll(query, options);
		return result?.podcasts ?? [];
	}

	async searchEpisodes(query, options = {}) {
		const result = await this.searchAll(query, options);
		return result?.episodes ?? [];
	}

	async searchUsers(query, options = {}) {
		const result = await this.searchAll(query, options);
		return result?.users ?? [];
	}

	async searchFirstTrack(query, options = {}) {
		const tracks = await this.searchTracks(query, {
			limit: 10,
			numberOfTopResults: 5,
			...options,
		});

		return tracks[0] ?? null;
	}

	async track(input) {
		const { id } = this.#parseSpotifyInput(input, "track");

		const res = await this.query("track", {
			uri: `spotify:track:${id}`,
		});

		return this.parser.parseTrack(res.data?.trackUnion);
	}

	async artist(input, { locale = "" } = {}) {
		const { id } = this.#parseSpotifyInput(input, "artist");

		const res = await this.query("artist", {
			uri: `spotify:artist:${id}`,
			locale,
			preReleaseV2: false,
		});

		return this.parser.parseArtist(res.data?.artistUnion);
	}

	async album(input, { locale = "", offset = 0, limit = 50 } = {}) {
		const { id } = this.#parseSpotifyInput(input, "album");

		const res = await this.query("album", {
			uri: `spotify:album:${id}`,
			locale,
			offset,
			limit,
		});

		return this.parser.parseAlbum(res.data?.albumUnion);
	}

	async playlist(input, { offset = 0, limit = 25 } = {}) {
		const { id } = this.#parseSpotifyInput(input, "playlist");

		const res = await this.query("playlist", {
			uri: `spotify:playlist:${id}`,
			offset,
			limit,
			enableWatchFeedEntrypoint: false,
			includeEpisodeContentRatingsV2: false,
		});

		return this.parser.parsePlaylist(res.data?.playlistV2);
	}

	async url(input) {
		const { type, id } = this.#parseSpotifyInput(input);

		switch (type) {
			case "track":
				return this.track(id);
			case "artist":
				return this.artist(id);
			case "album":
				return this.album(id);
			case "playlist":
				return this.playlist(id);
			default:
				throw new Error("Unsupported Spotify URL/type.");
		}
	}
}

export { Parser, Spotify };
export default Spotify;

// const spotify = new Spotify();

// const search = await spotify.search("yoasobi idol");
// console.log(JSON.stringify(search, null, 2));
