/* app.js — YouTube Data Extractor Frontend */
document.addEventListener('DOMContentLoaded', () => {
    // ======================== Initialize ========================
    initParticles();

    // ======================== DOM Elements ========================
    const searchInput = document.getElementById('search-input');
    const searchBtn = document.getElementById('search-btn');
    const skeletonSection = document.getElementById('skeleton-section');
    const resultsSection = document.getElementById('results-section');
    const errorContainer = document.getElementById('error-container');
    const errorMessage = document.getElementById('error-message');
    const downloadBtn = document.getElementById('download-btn');

    // Settings elements
    const settingsToggleBtn = document.getElementById('settings-toggle-btn');
    const settingsPanel = document.getElementById('settings-panel');
    const settingsCloseBtn = document.getElementById('settings-close-btn');
    const apiKeyInput = document.getElementById('api-key-input');
    const toggleKeyVisibility = document.getElementById('toggle-key-visibility');
    const testKeyBtn = document.getElementById('test-key-btn');
    const saveKeyBtn = document.getElementById('save-key-btn');
    const keyTestResult = document.getElementById('key-test-result');
    const keyStatusBadge = document.getElementById('key-status-badge');
    const keyBadgeText = document.getElementById('key-badge-text');

    // ======================== State ========================
    let extractedData = null;
    let isLoading = false;
    let shortsDisplayed = 0;
    let longsDisplayed = 0;
    const BATCH_SIZE = 50;

    // ======================== Init: Check Key Status ========================
    checkKeyStatus();

    // Load saved API key from localStorage
    const savedKey = localStorage.getItem('yt_api_key');
    if (savedKey) {
        apiKeyInput.value = savedKey;
    }

    // ======================== Settings Events ========================
    const cookiesInput = document.getElementById('cookies-input');
    const saveCookiesBtn = document.getElementById('save-cookies-btn');
    const cookiesSaveResult = document.getElementById('cookies-save-result');
    const browseCookiesBtn = document.getElementById('browse-cookies-btn');
    const cookiesFileUpload = document.getElementById('cookies-file-upload');

    browseCookiesBtn.addEventListener('click', () => {
        cookiesFileUpload.click();
    });

    cookiesFileUpload.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        
        const reader = new FileReader();
        reader.onload = (e) => {
            cookiesInput.value = e.target.result;
            cookiesSaveResult.innerHTML = '✅ File loaded! Click "Save Cookies" to apply.';
            cookiesSaveResult.className = 'key-test-result success';
            cookiesSaveResult.classList.remove('hidden');
        };
        reader.readAsText(file);
    });

    settingsToggleBtn.addEventListener('click', async () => {
        settingsPanel.classList.remove('hidden');
        // Load existing cookies if any
        try {
            const res = await fetch('/api/get-cookies');
            if (res.ok) {
                const data = await res.json();
                cookiesInput.value = data.cookies;
            }
        } catch (e) {}
    });

    settingsCloseBtn.addEventListener('click', () => {
        settingsPanel.classList.add('hidden');
        keyTestResult.classList.add('hidden');
        cookiesSaveResult.classList.add('hidden');
    });

    saveCookiesBtn.addEventListener('click', async () => {
        const cookiesText = cookiesInput.value.trim();
        if (!cookiesText) {
            cookiesSaveResult.innerHTML = '❌ Please paste cookies text first.';
            cookiesSaveResult.className = 'key-test-result error';
            cookiesSaveResult.classList.remove('hidden');
            return;
        }

        saveCookiesBtn.disabled = true;
        saveCookiesBtn.textContent = '💾 Saving...';
        
        try {
            const response = await fetch('/api/set-cookies', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ cookies: cookiesText })
            });

            if (response.ok) {
                cookiesSaveResult.innerHTML = '✅ Cookies saved permanently!';
                cookiesSaveResult.className = 'key-test-result success';
            } else {
                throw new Error('Failed to save cookies');
            }
        } catch (error) {
            cookiesSaveResult.innerHTML = `❌ Error: ${error.message}`;
            cookiesSaveResult.className = 'key-test-result error';
        } finally {
            cookiesSaveResult.classList.remove('hidden');
            saveCookiesBtn.disabled = false;
            saveCookiesBtn.textContent = '💾 Save Cookies';
        }
    });

    toggleKeyVisibility.addEventListener('click', () => {
        if (apiKeyInput.type === 'password') {
            apiKeyInput.type = 'text';
            toggleKeyVisibility.textContent = '🙈';
        } else {
            apiKeyInput.type = 'password';
            toggleKeyVisibility.textContent = '👁️';
        }
    });

    testKeyBtn.addEventListener('click', testApiKey);
    saveKeyBtn.addEventListener('click', saveApiKey);

    async function testApiKey() {
        const key = apiKeyInput.value.trim();
        if (!key) {
            showKeyResult('Please enter an API key first.', 'error');
            return;
        }

        testKeyBtn.disabled = true;
        testKeyBtn.textContent = '⏳ Testing...';

        try {
            const response = await fetch('/api/test-key', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ api_key: key })
            });

            const result = await response.json();

            if (response.ok) {
                showKeyResult(result.message, 'success');
                localStorage.setItem('yt_api_key', key);
                updateKeyBadge(true, key);
                showToast('API key verified and saved!', 'success');
            } else {
                showKeyResult(result.detail || 'Key test failed', 'error');
            }
        } catch (error) {
            showKeyResult('Connection error. Is the server running?', 'error');
        } finally {
            testKeyBtn.disabled = false;
            testKeyBtn.textContent = '🧪 Test Key';
        }
    }

    async function saveApiKey() {
        const key = apiKeyInput.value.trim();
        if (!key) {
            showKeyResult('Please enter an API key first.', 'error');
            return;
        }

        saveKeyBtn.disabled = true;
        saveKeyBtn.textContent = '⏳ Saving...';

        try {
            const response = await fetch('/api/set-key', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ api_key: key })
            });

            const result = await response.json();

            if (response.ok) {
                localStorage.setItem('yt_api_key', key);
                updateKeyBadge(true, key);
                showKeyResult('API key saved for this session.', 'success');
                showToast('API key saved!', 'success');
            } else {
                showKeyResult(result.detail || 'Failed to save key', 'error');
            }
        } catch (error) {
            showKeyResult('Connection error. Is the server running?', 'error');
        } finally {
            saveKeyBtn.disabled = false;
            saveKeyBtn.textContent = '💾 Save Key';
        }
    }

    async function checkKeyStatus() {
        try {
            const response = await fetch('/api/key-status');
            const result = await response.json();
            updateKeyBadge(result.has_key, result.has_key ? 'configured' : null);

            // If no key on server but we have one saved locally, push it
            if (!result.has_key && savedKey) {
                fetch('/api/set-key', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ api_key: savedKey })
                }).then(r => {
                    if (r.ok) updateKeyBadge(true, 'configured');
                });
            }
        } catch (e) {
            // Server might not be running yet
        }
    }

    function updateKeyBadge(hasKey, key) {
        keyStatusBadge.classList.remove('hidden', 'active', 'inactive');
        if (hasKey) {
            keyStatusBadge.classList.add('active');
            keyBadgeText.textContent = 'Key Active';
        } else {
            keyStatusBadge.classList.add('inactive');
            keyBadgeText.textContent = 'No Key';
        }
    }

    function showKeyResult(message, type) {
        keyTestResult.textContent = message;
        keyTestResult.className = `key-test-result ${type}`;
        keyTestResult.classList.remove('hidden');
    }

    // ======================== Search Events ========================
    searchBtn.addEventListener('click', performSearch);
    searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') performSearch();
        if (e.key === 'Escape') {
            searchInput.value = '';
            searchInput.blur();
        }
    });

    // ======================== Collapsible Sections ========================
    document.querySelectorAll('.table-header').forEach(header => {
        header.addEventListener('click', () => {
            header.parentElement.classList.toggle('collapsed');
            const isExpanded = !header.parentElement.classList.contains('collapsed');
            header.setAttribute('aria-expanded', isExpanded);
        });
    });

    // ======================== Tweak 5: Table Sorting ========================
    document.querySelectorAll('th[data-sort]').forEach(th => {
        th.addEventListener('click', () => {
            const table = th.closest('table');
            const tbody = table.querySelector('tbody');
            const rows = Array.from(tbody.querySelectorAll('tr'));
            const sortType = th.getAttribute('data-sort');
            const isAsc = th.classList.contains('sort-asc');
            
            // Clear all sort classes
            table.querySelectorAll('th').forEach(h => h.classList.remove('sort-asc', 'sort-desc'));
            th.classList.add(isAsc ? 'sort-desc' : 'sort-asc');
            
            const colIndex = Array.from(th.parentElement.children).indexOf(th);
            
            rows.sort((a, b) => {
                const aVal = a.children[colIndex].getAttribute('data-val');
                const bVal = b.children[colIndex].getAttribute('data-val');
                
                let res = 0;
                if (sortType === 'date') {
                    res = new Date(aVal) - new Date(bVal);
                } else {
                    res = parseFloat(aVal) - parseFloat(bVal);
                }
                return isAsc ? res : -res;
            });
            
            tbody.innerHTML = '';
            rows.forEach(r => tbody.appendChild(r));
        });
    });

    // ======================== Download Event ========================
    downloadBtn.addEventListener('click', handleDownload);

    // ======================== Search Function ========================
    async function performSearch() {
        const query = searchInput.value.trim();
        if (!query) {
            showToast('Please enter a channel URL or @handle', 'error');
            searchInput.focus();
            return;
        }

        if (isLoading) return;
        isLoading = true;
        
        // Tweak 1: Top Progress Bar
        const topProgressBar = document.getElementById('top-progress-bar');
        topProgressBar.classList.add('loading');
        topProgressBar.style.width = '10%';
        let progressInterval = setInterval(() => {
            let currentWidth = parseFloat(topProgressBar.style.width);
            if (currentWidth < 90) {
                topProgressBar.style.width = (currentWidth + Math.random() * 5) + '%';
            }
        }, 300);

        // Update UI
        errorContainer.style.display = 'none';
        resultsSection.style.display = 'none';
        skeletonSection.style.display = 'block';
        searchBtn.disabled = true;
        searchBtn.querySelector('.search-btn-text').classList.add('hidden');
        searchBtn.querySelector('.search-btn-loading').classList.remove('hidden');

        try {
            const response = await fetch('/api/extract', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ query })
            });

            if (!response.ok) {
                const err = await response.json();
                throw new Error(err.detail || `Server error (${response.status})`);
            }
            
            topProgressBar.style.width = '100%';

            const json = await response.json();
            extractedData = json.data; // The array of channels

            skeletonSection.style.display = 'none';
            if (extractedData.length === 1) {
                renderSingleChannel(extractedData[0]);
            } else {
                renderMultiChannel(extractedData);
            }
            
            showToast(`Extracted data successfully!`, 'success');

        } catch (error) {
            skeletonSection.style.display = 'none';
            errorContainer.style.display = 'block';
            errorMessage.textContent = error.message || 'An unexpected error occurred';
            errorContainer.classList.remove('shake');
            void errorContainer.offsetWidth; // force reflow
            errorContainer.classList.add('shake');
            showToast(error.message || 'Extraction failed', 'error');
            topProgressBar.style.width = '100%';
            topProgressBar.style.background = '#ff0033'; // turn red on error

        } finally {
            isLoading = false;
            searchBtn.disabled = false;
            searchBtn.querySelector('.search-btn-text').classList.remove('hidden');
            searchBtn.querySelector('.search-btn-loading').classList.add('hidden');
            
            clearInterval(progressInterval);
            setTimeout(() => {
                topProgressBar.classList.remove('loading');
                setTimeout(() => { 
                    topProgressBar.style.width = '0%'; 
                    topProgressBar.style.background = 'var(--neon-red)';
                }, 300);
            }, 500);
        }
    }

    // ======================== Render Functions ========================
    function renderSingleChannel(data) {
        document.getElementById('multi-channel-section').classList.add('hidden');
        document.getElementById('results-section').classList.remove('hidden');
        document.getElementById('download-section').classList.remove('hidden');
        document.getElementById('results-section').style.display = 'block';

        const channel = data.channel;
        const summary = data.summary;

        // Channel Card
        document.getElementById('channel-thumb').src = channel.thumbnail_url || '';
        
        // Tweak 2: Banner
        const bannerEl = document.getElementById('channel-banner');
        if (channel.banner_url) {
            bannerEl.style.backgroundImage = `url(${channel.banner_url})`;
        } else {
            bannerEl.style.backgroundImage = 'none';
        }
        
        document.getElementById('channel-title').textContent = channel.name;
        document.getElementById('channel-handle').textContent = channel.handle || '';
        document.getElementById('channel-subs').textContent = formatNumber(channel.subscriber_count) + ' subscribers';
        document.getElementById('channel-views').textContent = formatNumber(channel.view_count) + ' views';
        document.getElementById('channel-date').textContent = channel.published_at ? formatDate(channel.published_at) : '—';

        // Stats with count-up animation
        animateCountUp(document.getElementById('stat-total'), summary.total_videos, 1500);
        animateCountUp(document.getElementById('stat-shorts'), summary.total_shorts, 1500);
        animateCountUp(document.getElementById('stat-longs'), summary.total_longs, 1500);

        // Count labels
        document.getElementById('shorts-count-label').textContent = `(${summary.total_shorts.toLocaleString()})`;
        document.getElementById('longs-count-label').textContent = `(${summary.total_longs.toLocaleString()})`;

        // Tables
        shortsDisplayed = 0;
        longsDisplayed = 0;
        document.getElementById('shorts-table-body').innerHTML = '';
        document.getElementById('longs-table-body').innerHTML = '';
        loadMoreVideos('shorts');
        loadMoreVideos('longs');
    }

    function loadMoreVideos(type) {
        // extractedData is an array of channels. If we are rendering single channel, it's at index 0.
        const singleChannelData = Array.isArray(extractedData) ? extractedData[0] : extractedData;
        const videos = type === 'shorts' ? singleChannelData.shorts : singleChannelData.long_videos;
        
        const tbodyId = type === 'shorts' ? 'shorts-table-body' : 'longs-table-body';
        const loadMoreId = type === 'shorts' ? 'shorts-load-more' : 'longs-load-more';
        let displayed = type === 'shorts' ? shortsDisplayed : longsDisplayed;

        const startIndex = type === 'shorts' ? shortsDisplayed : longsDisplayed;
        const endIndex = Math.min(startIndex + BATCH_SIZE, videos.length);
        const loadMoreWrapper = document.getElementById(loadMoreId);
        const tbody = document.getElementById(tbodyId);
        const videosToRender = videos.slice(startIndex, endIndex);

        videosToRender.forEach((v, idx) => {
            const tr = document.createElement('tr');
            
            // Generate exact youtube URL
            const url = type === 'shorts' 
                ? `https://youtube.com/shorts/${v.video_id}`
                : `https://youtube.com/watch?v=${v.video_id}`;

            tr.innerHTML = `
                <td>${startIndex + idx + 1}</td>
                <td title="${v.title}">
                    <div style="display:flex; align-items:center; gap:8px;">
                        <img src="${v.thumbnail_url}" style="width:50px; border-radius:4px;">
                        <span>${truncate(v.title, 45)}</span>
                    </div>
                </td>
                <td data-val="${v.duration_seconds}">${v.duration_formatted}</td>
                <td data-val="${v.published_at}">${formatDate(v.published_at)}</td>
                <td data-val="${v.view_count}">${formatNumber(v.view_count)}</td>
                <td data-val="${v.like_count}">${formatNumber(v.like_count)}</td>
                <td data-val="${v.comment_count}">${formatNumber(v.comment_count)}</td>
                <td>
                    <div style="display: flex; gap: 5px;">
                        <a href="${url}" target="_blank" rel="noopener" class="btn-text">View</a>
                        <button class="icon-btn copy-btn" data-url="${url}" aria-label="Copy Link" title="Copy Link">📋</button>
                    </div>
                </td>
            `;
            tbody.appendChild(tr);
        });

        // Add copy event listeners
        tbody.querySelectorAll('.copy-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const link = e.currentTarget.getAttribute('data-url');
                navigator.clipboard.writeText(link).then(() => {
                    showToast('Link copied to clipboard!', 'success');
                });
            });
        });

        if (type === 'shorts') shortsDisplayed = endIndex;
        else longsDisplayed = endIndex;

        if (endIndex < videos.length) {
            loadMoreWrapper.classList.remove('hidden');
            const btn = loadMoreWrapper.querySelector('button');
            const newBtn = btn.cloneNode(true);
            btn.parentNode.replaceChild(newBtn, btn);
            newBtn.addEventListener('click', () => loadMoreVideos(type));
        } else {
            loadMoreWrapper.classList.add('hidden');
        }
    }

    function renderMultiChannel(dataArray) {
        document.getElementById('results-section').style.display = 'none';
        document.getElementById('multi-channel-section').classList.remove('hidden');
        document.getElementById('download-section').classList.remove('hidden');
        
        const listContainer = document.getElementById('multi-channel-list');
        listContainer.innerHTML = '';
        
        dataArray.forEach(data => {
            const ch = data.channel;
            const div = document.createElement('div');
            div.style.cssText = 'background: rgba(255,255,255,0.05); border: 1px solid var(--glass-border); border-radius: 12px; padding: 15px; width: 220px; text-align: center; display: flex; flex-direction: column; align-items: center;';
            div.innerHTML = `
                <img src="${ch.thumbnail_url}" style="width: 60px; height: 60px; border-radius: 50%; border: 2px solid var(--neon-blue); margin-bottom: 10px;">
                <h3 style="font-size: 1.1rem; margin-bottom: 5px; color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%;">${ch.name}</h3>
                <div style="color: var(--text-secondary); font-size: 0.85rem; margin-bottom: 10px;">${ch.handle}</div>
                <div style="display: flex; gap: 15px; font-size: 0.8rem; color: #ddd; width: 100%; justify-content: center; background: rgba(0,0,0,0.3); border-radius: 6px; padding: 5px;">
                    <div title="Subscribers">👥 ${formatNumber(ch.subscriber_count)}</div>
                    <div title="Total Views">👁️ ${formatNumber(ch.view_count)}</div>
                </div>
            `;
            listContainer.appendChild(div);
        });
    }

    // ======================== Excel Download ========================
    downloadBtn.addEventListener('click', handleDownload);
    async function handleDownload() {
        const queryInput = document.getElementById('search-input').value.trim();
        if (!queryInput || isLoading) return;
        
        // Disable button and show spinner
        downloadBtn.disabled = true;
        downloadBtn.querySelector('.download-btn-text').classList.add('hidden');
        downloadBtn.querySelector('.download-btn-loading').classList.remove('hidden');
        
        showToast('Generating Excel report... (this may take up to 60 seconds)', 'success');
        
        try {
            // Use GET endpoint to bypass Vercel's 4.5MB request body limit
            const url = `/api/download-excel?query=${encodeURIComponent(queryInput)}`;
            const response = await fetch(url);
            
            if (!response.ok) {
                let errText = await response.text();
                try {
                    let errObj = JSON.parse(errText);
                    throw new Error(errObj.detail || 'Download failed');
                } catch (e) {
                    throw new Error(`Server returned ${response.status}`);
                }
            }
            
            // Get the blob and trigger download natively
            const blob = await response.blob();
            const blobUrl = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = blobUrl;
            
            // Extract filename from header
            const disposition = response.headers.get('Content-Disposition');
            let filename = 'YouTube_Channel_Data.xlsx';
            if (disposition) {
                const match = disposition.match(/filename="?(.+?)"?$/);
                if (match) filename = decodeURIComponent(match[1]);
            }
            
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            a.remove();
            window.URL.revokeObjectURL(blobUrl);
            
            showToast('Excel report downloaded successfully!', 'success');
            
        } catch (error) {
            showToast('Download failed: ' + error.message, 'error');
        } finally {
            // Re-enable button
            downloadBtn.disabled = false;
            downloadBtn.querySelector('.download-btn-text').classList.remove('hidden');
            downloadBtn.querySelector('.download-btn-loading').classList.add('hidden');
        }
    }

    // ======================== Utilities ========================
    function formatNumber(num) {
        if (num === null || num === undefined) return '0';
        num = parseInt(num);
        if (num >= 1e9) return (num / 1e9).toFixed(1) + 'B';
        if (num >= 1e6) return (num / 1e6).toFixed(1) + 'M';
        if (num >= 1e3) return (num / 1e3).toFixed(1) + 'K';
        return num.toLocaleString();
    }

    function formatDate(isoString) {
        if (!isoString) return '—';
        try {
            const d = new Date(isoString);
            return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        } catch {
            return isoString;
        }
    }

    function truncate(str, len) {
        if (!str) return '';
        return str.length > len ? str.substring(0, len) + '...' : str;
    }

    function escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.appendChild(document.createTextNode(text));
        return div.innerHTML;
    }

    function animateCountUp(element, target, duration) {
        if (!target || target === 0) {
            element.textContent = '0';
            return;
        }
        let startTimestamp = null;
        const step = (timestamp) => {
            if (!startTimestamp) startTimestamp = timestamp;
            const progress = Math.min((timestamp - startTimestamp) / duration, 1);
            // Ease out cubic
            const eased = 1 - Math.pow(1 - progress, 3);
            element.textContent = Math.floor(eased * target).toLocaleString();
            if (progress < 1) {
                window.requestAnimationFrame(step);
            } else {
                element.textContent = target.toLocaleString();
            }
        };
        window.requestAnimationFrame(step);
    }

    function showToast(message, type) {
        const container = document.getElementById('toast-container');
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.textContent = message;
        container.appendChild(toast);
        
        setTimeout(() => {
            toast.style.animation = 'fadeOutUp 0.3s forwards';
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    }
    window.showToast = showToast; // Expose globally for inline onclick handlers

    // ======================== Particle System ========================
    function initParticles() {
        const canvas = document.getElementById('particles');
        const ctx = canvas.getContext('2d');
        let particles = [];
        let animationId;

        function resize() {
            canvas.width = window.innerWidth;
            canvas.height = window.innerHeight;
        }
        window.addEventListener('resize', resize);
        resize();

        class Particle {
            constructor() {
                this.x = Math.random() * canvas.width;
                this.y = Math.random() * canvas.height;
                this.vx = (Math.random() - 0.5) * 0.4;
                this.vy = (Math.random() - 0.5) * 0.4;
                this.radius = Math.random() * 1.5 + 0.5;
                // Mix of white and blue particles
                this.color = Math.random() > 0.7
                    ? `rgba(0, 212, 255, ${0.3 + Math.random() * 0.3})`
                    : `rgba(255, 255, 255, ${0.2 + Math.random() * 0.3})`;
            }

            update() {
                this.x += this.vx;
                this.y += this.vy;
                if (this.x < 0 || this.x > canvas.width) this.vx *= -1;
                if (this.y < 0 || this.y > canvas.height) this.vy *= -1;
            }

            draw() {
                ctx.beginPath();
                ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
                ctx.fillStyle = this.color;
                ctx.fill();
            }
        }

        for (let i = 0; i < 80; i++) {
            particles.push(new Particle());
        }

        function animate() {
            ctx.clearRect(0, 0, canvas.width, canvas.height);

            for (let i = 0; i < particles.length; i++) {
                particles[i].update();
                particles[i].draw();

                // Draw connecting lines between nearby particles
                for (let j = i + 1; j < particles.length; j++) {
                    const dx = particles[i].x - particles[j].x;
                    const dy = particles[i].y - particles[j].y;
                    const dist = Math.sqrt(dx * dx + dy * dy);

                    if (dist < 120) {
                        ctx.beginPath();
                        ctx.moveTo(particles[i].x, particles[i].y);
                        ctx.lineTo(particles[j].x, particles[j].y);
                        ctx.strokeStyle = `rgba(0, 212, 255, ${(1 - dist / 120) * 0.15})`;
                        ctx.lineWidth = 0.5;
                        ctx.stroke();
                    }
                }
            }
            animationId = requestAnimationFrame(animate);
        }

        animate();
    }
});
