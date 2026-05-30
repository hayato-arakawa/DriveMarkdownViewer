// Background service worker for Drive Markdown Viewer
// Handles fetching file content via Google Drive API using cookies-based auth
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'FETCH_DRIVE_FILE') {
        fetchDriveFile(message.fileId)
            .then(content => sendResponse({ success: true, content }))
            .catch(error => sendResponse({ success: false, error: error.message }));
        return true; // Keep the message channel open for async response
    }
});
async function fetchDriveFile(fileId) {
    // Try fetching via the export link that works with the user's existing session cookies
    const url = `https://drive.google.com/uc?id=${fileId}&export=download`;
    const response = await fetch(url, {
        credentials: 'include',
        redirect: 'follow'
    });
    if (!response.ok) {
        throw new Error(`Failed to fetch file: ${response.status} ${response.statusText}`);
    }
    const text = await response.text();
    return text;
}