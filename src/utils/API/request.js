import axios from "axios";

function createClient(baseURL) {
	const instance = axios.create({
		baseURL,
		validateStatus: () => true,
	});
	return instance;
}

function makeClient(instance) {
	const safeCall =
		(fn) =>
		async (...args) => {
			try {
				return await fn(...args);
			} catch (e) {
				return e?.response;
			}
		};

	return {
		get: safeCall((path, params, options) =>
			instance.get(path, { params, ...options })
		),
		post: safeCall((path, data, options) =>
			instance.post(path, data, options)
		),
		request: safeCall((options) => instance.request({ ...options })),
	};
}

export const Gratis = makeClient(createClient("https://api.apigratis.cc"));
export const Sayuran = makeClient(createClient("https://sayuran.vip/api"));

export const APIRequest = { Gratis, Sayuran };

export default APIRequest;
