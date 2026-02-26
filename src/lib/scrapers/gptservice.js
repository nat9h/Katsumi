import axios from "axios";

/**
 * Service class for interacting with GPT AI API
 * @class GptService
 * @description Provides methods to communicate with the GPT-4 AI model through external API
 *
 * @example
 * // Basic usage
 * const response = await GptService.process("Hello, how are you?");
 *
 * @example
 * // With custom options
 * const response = await GptService.process("Explain quantum physics", {
 *	 temperature: 0.7,
 *	 prompt: "Explain in simple terms"
 * });
 */
export class GptService {
	/**
	 * Processes input text through GPT-4 AI model and returns the response
	 * @static
	 * @async
	 * @function process
	 * @param {string} input - The input text/message to send to the AI model
	 * @param {Object} [options={}] - Additional options for the AI request
	 * @param {string} [options.prompt=null] - Optional system prompt to guide the AI response
	 * @param {number} [options.temperature=0.5] - Controls randomness of response (0.0 to 1.0)
	 * @returns {Promise<Object>} The AI response data from the API
	 * @throws {Error} If the API request fails or returns an error
	 *
	 * @description
	 * Sends a request to the GPT-4 AI model with the provided input and options.
	 * The method handles the API communication and error handling for AI processing.
	 *
	 * @see {@link https://chateverywhere.app/api/chat/} API endpoint documentation
	 *
	 * @example
	 * try {
	 *	 const result = await GptService.process("What is the meaning of life?");
	 *	 console.log(result);
	 * } catch (error) {
	 *	 console.error("AI service error:", error.message);
	 * }
	 */
	static async process(input, options = {}) {
		try {
			/**
			 * Configuration for the AI model parameters
			 * @type {Object}
			 * @property {Object} model - AI model configuration
			 * @property {string} model.id - Model identifier ("gpt-4")
			 * @property {string} model.name - Model display name ("GPT-4")
			 * @property {number} model.maxLength - Maximum token length (32000)
			 * @property {number} model.tokencoin - Token cost for input (8000)
			 * @property {number} model.completionTokencoin - Token cost for completion (5000)
			 * @property {string} model.deploymentName - Deployment identifier ("gpt-4")
			 * @property {Array<Object>} messages - Conversation messages array
			 * @property {string} messages[].pluginId - Plugin identifier (null for no plugin)
			 * @property {string} messages[].content - The input text content
			 * @property {string} messages[].role - Message role ("user")
			 * @property {string|null} prompt - Optional system prompt
			 * @property {number} temperature - Creativity control (0.0 = deterministic, 1.0 = creative)
			 */
			const requestPayload = {
				model: {
					id: "gpt-4",
					name: "GPT-4",
					maxLength: 32000,
					tokencoin: 8000,
					completionTokencoin: 5000,
					deploymentName: "gpt-4",
				},
				messages: [
					{
						pluginId: null,
						content: input,
						role: "user",
					},
				],
				prompt: options.prompt || null,
				temperature: options.temperature || 0.5,
			};

			/**
			 * HTTP headers for the API request
			 * @type {Object}
			 */
			const requestHeaders = {
				Accept: "*/*",
				"User-Agent":
					"Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
			};

			// Make POST request to the AI API
			const response = await axios.post(
				"https://chateverywhere.app/api/chat/",
				requestPayload,
				{
					headers: requestHeaders,
				}
			);

			return response.data;
		} catch (error) {
			/**
			 * Enhanced error message with API error details if available
			 * @type {string}
			 */
			const errorMessage = `Failed to fetch AI response: ${error.response?.data?.error || error.message}`;

			throw new Error(errorMessage);
		}
	}
}

export default GptService;
